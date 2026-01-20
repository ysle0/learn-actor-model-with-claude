# MMO 아키텍처

> 대규모 다중 사용자 온라인 게임(MMO)에서 Actor Model을 활용한 아키텍처 설계를 다룹니다.

## 한 줄 요약

**MMO는 Zone/Shard 기반 분산 + Actor Model로 수만~수십만 동시 접속자를 처리**

---

## MMO의 기술적 도전

```
┌─────────────────────────────────────────────────────────────────┐
│                    MMO 기술적 도전                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  규모의 문제:                                                    │
│  ────────────                                                   │
│  • 동시 접속자: 수만 ~ 수십만 명                                 │
│  • 월드 크기: 수백 ~ 수천 개 지역                               │
│  • 엔티티 수: 수백만 개 (플레이어, NPC, 아이템, 몬스터)          │
│                                                                 │
│  실시간 요구사항:                                                │
│  ────────────────                                               │
│  • 레이턴시: < 200ms (액션 피드백)                               │
│  • 상태 동기화: 초당 수십 회                                     │
│  • 영속화: 무중단, 데이터 손실 없음                              │
│                                                                 │
│  복잡성:                                                        │
│  ────────                                                       │
│  • 다양한 시스템 상호작용 (전투, 거래, 퀘스트, 길드...)          │
│  • 경제 시스템 밸런스                                            │
│  • 치팅/핵 방지                                                  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 기본 아키텍처 패턴

### Zone/Shard 아키텍처

```
┌─────────────────────────────────────────────────────────────────┐
│                   Zone/Shard 아키텍처                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│                      ┌───────────────┐                          │
│                      │  World Server │                          │
│                      │   (Manager)   │                          │
│                      └───────┬───────┘                          │
│                              │                                  │
│        ┌─────────────────────┼─────────────────────┐           │
│        │                     │                     │           │
│  ┌─────┴─────┐        ┌─────┴─────┐        ┌─────┴─────┐      │
│  │  Zone 1   │        │  Zone 2   │        │  Zone 3   │      │
│  │  (초원)   │◀──────▶│  (던전)   │◀──────▶│  (도시)   │      │
│  │           │        │           │        │           │      │
│  │ 500 users │        │ 200 users │        │ 1000 users│      │
│  └─────┬─────┘        └─────┬─────┘        └─────┬─────┘      │
│        │                    │                    │             │
│   ┌────┴────┐          ┌────┴────┐          ┌────┴────┐       │
│   │ Players │          │ Players │          │ Players │       │
│   │ NPCs    │          │ Monsters│          │ Shops   │       │
│   │ Mobs    │          │ Bosses  │          │ NPCs    │       │
│   └─────────┘          └─────────┘          └─────────┘       │
│                                                                 │
│  Zone 간 이동:                                                  │
│  • 플레이어가 Zone 경계 통과 시                                 │
│  • 현재 Zone에서 상태 직렬화                                    │
│  • 새 Zone으로 상태 전송 및 복원                                │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Actor 기반 구현

```csharp
// Zone Actor
public interface IZoneGrain : IGrainWithStringKey
{
    Task<bool> EnterZone(string playerId, PlayerState state);
    Task LeaveZone(string playerId);
    Task ProcessAction(string playerId, GameAction action);
    Task<ZoneState> GetVisibleState(string playerId, Position position);
}

public class ZoneGrain : Grain, IZoneGrain
{
    private readonly Dictionary<string, PlayerState> _players = new();
    private readonly Dictionary<string, NpcState> _npcs = new();
    private readonly Dictionary<string, MonsterState> _monsters = new();
    private readonly SpatialHash<IEntity> _spatialIndex;

    private IDisposable _tickTimer;

    public override Task OnActivateAsync(CancellationToken token)
    {
        // Zone 초기화 (NPC, 몬스터 스폰 등)
        InitializeZone();

        // 게임 루프 시작 (30Hz)
        _tickTimer = RegisterTimer(
            OnTick,
            null,
            TimeSpan.FromMilliseconds(33),
            TimeSpan.FromMilliseconds(33)
        );

        return base.OnActivateAsync(token);
    }

    public async Task<bool> EnterZone(string playerId, PlayerState state)
    {
        if (_players.Count >= MaxPlayersInZone)
            return false;

        _players[playerId] = state;
        _spatialIndex.Insert(state.Position, state);

        // 주변 플레이어에게 알림
        await NotifyNearbyPlayers(state.Position, new PlayerEntered(playerId));

        return true;
    }

    private async Task OnTick(object _)
    {
        // 몬스터 AI 업데이트
        foreach (var monster in _monsters.Values)
        {
            monster.UpdateAI(_players.Values);
        }

        // NPC 상태 업데이트
        foreach (var npc in _npcs.Values)
        {
            npc.Update();
        }

        // 리스폰 체크
        CheckRespawns();

        // 상태 브로드캐스트 (델타만)
        await BroadcastStateUpdates();
    }
}
```

---

## 관심 영역 (Area of Interest)

### AOI 개념

```
┌─────────────────────────────────────────────────────────────────┐
│                  관심 영역 (AOI) 시스템                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  문제:                                                          │
│  ──────                                                         │
│  Zone에 1000명이 있을 때, 모든 사람에게 모든 정보 전송?          │
│  → 1000 × 1000 = 1,000,000 메시지/tick → 불가능                 │
│                                                                 │
│  해결: 시야 범위 내 엔티티만 전송                                │
│  ───────────────────────────────────                            │
│                                                                 │
│        시야 범위 (View Distance)                                │
│              ┌─────────┐                                       │
│              │    ●    │  ← Player                             │
│              │  ● ○ ●  │  ← 시야 내 엔티티만 보임              │
│              │    ●    │                                       │
│              └─────────┘                                       │
│                  │                                              │
│  ─────────────────┼─────────────────                            │
│                  │                                              │
│              ●   │   ●     ← 시야 밖 = 업데이트 안 받음        │
│                  │                                              │
│                                                                 │
│  효과:                                                          │
│  ──────                                                         │
│  • N² → N × k (k = 시야 내 평균 엔티티 수)                      │
│  • 대역폭 대폭 감소                                              │
│  • 처리량 대폭 감소                                              │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 공간 해싱 구현

```csharp
// 공간 해싱을 이용한 효율적 AOI
public class SpatialHash<T> where T : IPositionable
{
    private readonly Dictionary<(int, int), HashSet<T>> _cells;
    private readonly float _cellSize;

    public SpatialHash(float cellSize = 100f)
    {
        _cells = new Dictionary<(int, int), HashSet<T>>();
        _cellSize = cellSize;
    }

    private (int, int) GetCell(Position pos)
    {
        return ((int)(pos.X / _cellSize), (int)(pos.Z / _cellSize));
    }

    public void Insert(T entity)
    {
        var cell = GetCell(entity.Position);
        if (!_cells.ContainsKey(cell))
            _cells[cell] = new HashSet<T>();
        _cells[cell].Add(entity);
    }

    public void Update(T entity, Position oldPos, Position newPos)
    {
        var oldCell = GetCell(oldPos);
        var newCell = GetCell(newPos);

        if (oldCell != newCell)
        {
            _cells[oldCell]?.Remove(entity);
            Insert(entity);
        }
    }

    // 범위 내 엔티티 조회 - O(k) where k = nearby entities
    public IEnumerable<T> QueryRadius(Position center, float radius)
    {
        var cellRadius = (int)Math.Ceiling(radius / _cellSize);
        var centerCell = GetCell(center);

        for (int dx = -cellRadius; dx <= cellRadius; dx++)
        {
            for (int dz = -cellRadius; dz <= cellRadius; dz++)
            {
                var cell = (centerCell.Item1 + dx, centerCell.Item2 + dz);
                if (_cells.TryGetValue(cell, out var entities))
                {
                    foreach (var entity in entities)
                    {
                        if (Distance(center, entity.Position) <= radius)
                            yield return entity;
                    }
                }
            }
        }
    }
}

// Zone에서 AOI 활용
public class ZoneGrain
{
    private readonly SpatialHash<IEntity> _spatialIndex;
    private const float ViewDistance = 200f;

    public async Task OnPlayerMove(string playerId, Position newPos)
    {
        var player = _players[playerId];
        var oldPos = player.Position;

        // 공간 인덱스 업데이트
        _spatialIndex.Update(player, oldPos, newPos);
        player.Position = newPos;

        // 시야 변경 계산
        var oldNearby = _spatialIndex.QueryRadius(oldPos, ViewDistance).ToHashSet();
        var newNearby = _spatialIndex.QueryRadius(newPos, ViewDistance).ToHashSet();

        // 시야에서 벗어난 엔티티
        var disappeared = oldNearby.Except(newNearby);
        // 새로 시야에 들어온 엔티티
        var appeared = newNearby.Except(oldNearby);

        // 플레이어에게 알림
        await player.SendVisibilityChanges(disappeared, appeared);

        // 주변 플레이어에게 이동 알림
        foreach (var nearby in newNearby.OfType<PlayerState>())
        {
            if (nearby.PlayerId != playerId)
            {
                await nearby.SendEntityMoved(playerId, newPos);
            }
        }
    }
}
```

---

## 분산 아키텍처

### 마이크로서비스 + Actor

```
┌─────────────────────────────────────────────────────────────────┐
│                  MMO 마이크로서비스 아키텍처                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    Gateway Cluster                       │   │
│  │              (Load Balancer + Auth)                      │   │
│  └─────────────────────────┬───────────────────────────────┘   │
│                            │                                    │
│  ┌─────────────────────────┼───────────────────────────────┐   │
│  │                         │                                │   │
│  │   ┌─────────┐    ┌─────┴─────┐    ┌─────────┐          │   │
│  │   │  Chat   │    │   World   │    │  Guild  │          │   │
│  │   │ Service │    │  Service  │    │ Service │          │   │
│  │   │(Actors) │    │ (Actors)  │    │(Actors) │          │   │
│  │   └─────────┘    └─────┬─────┘    └─────────┘          │   │
│  │                        │                                 │   │
│  │   ┌─────────┐    ┌─────┴─────┐    ┌─────────┐          │   │
│  │   │  Trade  │    │   Zone    │    │  Quest  │          │   │
│  │   │ Service │    │ Cluster   │    │ Service │          │   │
│  │   │(Actors) │    │ (Actors)  │    │(Actors) │          │   │
│  │   └─────────┘    └───────────┘    └─────────┘          │   │
│  │                                                          │   │
│  │   ┌─────────┐    ┌───────────┐    ┌─────────┐          │   │
│  │   │ Auction │    │  Ranking  │    │ Friends │          │   │
│  │   │ Service │    │  Service  │    │ Service │          │   │
│  │   └─────────┘    └───────────┘    └─────────┘          │   │
│  │                                                          │   │
│  └──────────────────────────────────────────────────────────┘   │
│                            │                                    │
│  ┌─────────────────────────┴───────────────────────────────┐   │
│  │                    Data Layer                            │   │
│  │     ┌─────────┐  ┌─────────┐  ┌─────────┐              │   │
│  │     │  Redis  │  │ MongoDB │  │PostgreSQL│              │   │
│  │     │ (Cache) │  │ (Game)  │  │(Account)│              │   │
│  │     └─────────┘  └─────────┘  └─────────┘              │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Zone 간 통신

```csharp
// Zone 간 플레이어 이동
public class ZoneTransferService
{
    public async Task<TransferResult> TransferPlayer(
        string playerId,
        string fromZoneId,
        string toZoneId,
        Position entryPoint)
    {
        var fromZone = GrainFactory.GetGrain<IZoneGrain>(fromZoneId);
        var toZone = GrainFactory.GetGrain<IZoneGrain>(toZoneId);

        // 1. 현재 Zone에서 플레이어 상태 추출
        var playerState = await fromZone.ExtractPlayer(playerId);
        if (playerState == null)
            return TransferResult.PlayerNotFound;

        // 2. 새 Zone에 입장 시도
        playerState.Position = entryPoint;
        var entered = await toZone.EnterZone(playerId, playerState);

        if (!entered)
        {
            // 실패 시 원래 Zone으로 복귀
            await fromZone.RestorePlayer(playerId, playerState);
            return TransferResult.TargetZoneFull;
        }

        // 3. 원래 Zone에서 제거 확정
        await fromZone.ConfirmLeave(playerId);

        // 4. 플레이어에게 새 Zone 정보 전송
        var player = GrainFactory.GetGrain<IPlayerGrain>(playerId);
        await player.OnZoneChanged(toZoneId, entryPoint);

        return TransferResult.Success;
    }
}

// Cross-Zone 상호작용 (예: 다른 Zone의 플레이어에게 귓속말)
public class CrossZoneChatService
{
    public async Task SendWhisper(
        string fromPlayerId,
        string toPlayerId,
        string message)
    {
        // 직접 Player Actor 호출 (Zone 무관)
        var targetPlayer = GrainFactory.GetGrain<IPlayerGrain>(toPlayerId);
        await targetPlayer.ReceiveWhisper(fromPlayerId, message);
    }
}
```

---

## 스케일링 전략

### 동적 Zone 분할

```
┌─────────────────────────────────────────────────────────────────┐
│                   동적 Zone 분할                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  문제: 특정 Zone에 플레이어 집중 (이벤트, 보스 등)               │
│                                                                 │
│  해결: Zone 동적 분할/병합                                       │
│                                                                 │
│  정상 상태:                     과부하 시:                       │
│  ┌─────────────┐               ┌──────┬──────┐                 │
│  │             │               │ Zone │ Zone │                 │
│  │   Zone A    │   ───────▶   │  A1  │  A2  │                 │
│  │  (800명)    │               │(400) │(400) │                 │
│  │             │               ├──────┼──────┤                 │
│  └─────────────┘               │ Zone │ Zone │                 │
│                                │  A3  │  A4  │                 │
│                                │(400) │(400) │                 │
│                                └──────┴──────┘                 │
│                                                                 │
│  구현:                                                          │
│  ──────                                                         │
│  • Zone 부하 모니터링                                           │
│  • 임계값 초과 시 분할 트리거                                   │
│  • 플레이어를 새 Sub-Zone으로 재배치                            │
│  • 부하 감소 시 병합                                            │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

```csharp
// 동적 Zone 분할 관리자
public class ZoneScaler
{
    private const int SplitThreshold = 500;  // 분할 임계값
    private const int MergeThreshold = 100;  // 병합 임계값

    public async Task MonitorAndScale()
    {
        foreach (var zoneId in GetAllZones())
        {
            var zone = GrainFactory.GetGrain<IZoneGrain>(zoneId);
            var stats = await zone.GetStats();

            if (stats.PlayerCount > SplitThreshold)
            {
                await SplitZone(zoneId);
            }
            else if (CanMerge(zoneId) && stats.PlayerCount < MergeThreshold)
            {
                await MergeZone(zoneId);
            }
        }
    }

    private async Task SplitZone(string zoneId)
    {
        var zone = GrainFactory.GetGrain<IZoneGrain>(zoneId);

        // 공간적으로 4분할
        var quadrants = await zone.GetQuadrantAssignments();

        for (int i = 0; i < 4; i++)
        {
            var subZoneId = $"{zoneId}_sub{i}";
            var subZone = GrainFactory.GetGrain<IZoneGrain>(subZoneId);

            foreach (var playerId in quadrants[i])
            {
                var playerState = await zone.ExtractPlayer(playerId);
                await subZone.EnterZone(playerId, playerState);

                // 클라이언트에 Zone 변경 알림
                var player = GrainFactory.GetGrain<IPlayerGrain>(playerId);
                await player.OnZoneChanged(subZoneId);
            }
        }

        // 원래 Zone을 라우터로 전환
        await zone.BecomeRouter(quadrants.Select(q => q.ZoneId).ToList());
    }
}
```

---

## 인스턴스 던전

```csharp
// 인스턴스 던전 관리
public interface IDungeonManagerGrain : IGrainWithIntegerKey
{
    Task<string> CreateInstance(string dungeonType, List<string> partyMembers);
    Task<bool> DestroyInstance(string instanceId);
    Task<DungeonInfo> GetInstanceInfo(string instanceId);
}

public class DungeonManagerGrain : Grain, IDungeonManagerGrain
{
    private readonly Dictionary<string, DungeonInstance> _instances = new();

    public async Task<string> CreateInstance(
        string dungeonType,
        List<string> partyMembers)
    {
        var instanceId = $"dungeon_{dungeonType}_{Guid.NewGuid():N}";

        // 던전 인스턴스 Actor 생성
        var dungeonGrain = GrainFactory.GetGrain<IDungeonGrain>(instanceId);
        await dungeonGrain.Initialize(dungeonType, partyMembers);

        // 파티원들을 던전으로 이동
        foreach (var playerId in partyMembers)
        {
            var player = GrainFactory.GetGrain<IPlayerGrain>(playerId);
            await player.EnterDungeon(instanceId);
        }

        _instances[instanceId] = new DungeonInstance
        {
            InstanceId = instanceId,
            DungeonType = dungeonType,
            CreatedAt = DateTime.UtcNow,
            Members = partyMembers
        };

        // 30분 후 자동 정리 타이머
        RegisterTimer(
            _ => CheckAndCleanup(instanceId),
            null,
            TimeSpan.FromMinutes(30),
            TimeSpan.MaxValue
        );

        return instanceId;
    }
}

// 던전 인스턴스 Actor
public class DungeonGrain : Grain, IDungeonGrain
{
    private DungeonState _state;
    private IDisposable _tickTimer;

    public async Task Initialize(string dungeonType, List<string> members)
    {
        _state = DungeonTemplates.Create(dungeonType);
        _state.Members = members.ToHashSet();

        // 던전 전용 게임 루프 (10Hz)
        _tickTimer = RegisterTimer(
            OnTick,
            null,
            TimeSpan.FromMilliseconds(100),
            TimeSpan.FromMilliseconds(100)
        );
    }

    private async Task OnTick(object _)
    {
        // 몬스터 AI
        foreach (var monster in _state.Monsters)
        {
            monster.UpdateAI(_state.Members);
        }

        // 보스 메카닉
        _state.Boss?.UpdateMechanics();

        // 타이머/페이즈 체크
        CheckPhaseTransition();

        // 클리어 체크
        if (IsDungeonCleared())
        {
            await OnDungeonCleared();
        }
    }

    private async Task OnDungeonCleared()
    {
        // 보상 분배
        var rewards = CalculateRewards();
        foreach (var memberId in _state.Members)
        {
            var player = GrainFactory.GetGrain<IPlayerGrain>(memberId);
            await player.ReceiveReward(rewards);
        }

        // 30초 후 자동 퇴장
        RegisterTimer(
            _ => KickAllMembers(),
            null,
            TimeSpan.FromSeconds(30),
            TimeSpan.MaxValue
        );
    }
}
```

---

## 성능 최적화

### 상태 동기화 최적화

```csharp
// 델타 압축 + 우선순위 기반 동기화
public class StateSynchronizer
{
    public async Task BroadcastOptimized(
        IEnumerable<PlayerState> players,
        GameState fullState)
    {
        foreach (var player in players)
        {
            // 시야 내 엔티티만
            var visibleEntities = GetVisibleEntities(player.Position);

            // 델타 계산 (이전 전송 대비 변경분)
            var delta = CalculateDelta(
                player.LastSentState,
                visibleEntities
            );

            if (!delta.HasChanges)
                continue;

            // 우선순위 정렬 (가까운 것, 중요한 것 우선)
            var prioritized = delta.Changes
                .OrderBy(c => c.Priority)
                .ThenBy(c => Distance(player.Position, c.Position))
                .Take(MaxUpdatesPerPacket);

            // 압축 후 전송
            var packet = Compress(prioritized);
            await player.SendStateUpdate(packet);

            player.LastSentState = visibleEntities;
        }
    }
}
```

### 메시지 배치 처리

```csharp
// 메시지 배치로 네트워크 효율 향상
public class BatchedMessageSender
{
    private readonly Dictionary<string, List<GameMessage>> _batches = new();
    private readonly Timer _flushTimer;

    public BatchedMessageSender()
    {
        // 50ms마다 배치 전송 (20Hz)
        _flushTimer = new Timer(FlushAll, null, 50, 50);
    }

    public void Queue(string playerId, GameMessage message)
    {
        if (!_batches.ContainsKey(playerId))
            _batches[playerId] = new List<GameMessage>();

        _batches[playerId].Add(message);
    }

    private void FlushAll(object _)
    {
        foreach (var (playerId, messages) in _batches)
        {
            if (messages.Count == 0)
                continue;

            var batch = new MessageBatch(messages);
            SendToPlayer(playerId, batch);
            messages.Clear();
        }
    }
}
```

---

## 아키텍처 체크리스트

```
┌─────────────────────────────────────────────────────────────────┐
│                MMO 아키텍처 체크리스트                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Zone 설계:                                                     │
│  □ Zone 크기는 적절한가? (100-500명 권장)                       │
│  □ Zone 간 이동이 매끄러운가?                                   │
│  □ AOI 시스템이 구현되어 있는가?                                │
│  □ 동적 분할/병합이 가능한가?                                   │
│                                                                 │
│  Actor 설계:                                                    │
│  □ Actor 세분화가 적절한가?                                     │
│  □ 핫스팟 Actor가 없는가?                                       │
│  □ 상태 크기가 관리 가능한가?                                   │
│                                                                 │
│  확장성:                                                        │
│  □ Zone을 독립 서버로 분리할 수 있는가?                         │
│  □ 서비스별 독립 스케일링이 가능한가?                           │
│  □ 장애 격리가 되어 있는가?                                     │
│                                                                 │
│  성능:                                                          │
│  □ 상태 동기화 주기가 적절한가?                                 │
│  □ 메시지 배치 처리를 하고 있는가?                              │
│  □ 영속화 부하가 분산되어 있는가?                               │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 다음 단계

- [physics-simulation.md](./physics-simulation.md) - 물리 시뮬레이션과 Actor
- [fps-rts-patterns.md](./fps-rts-patterns.md) - 장르별 패턴
- [../06-game-server/state-persistence.md](../06-game-server/state-persistence.md) - 상태 영속화
