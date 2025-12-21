# 게임 서버에서의 Actor Model

> 대규모 온라인 게임에서의 Actor Model 활용 사례

## 왜 게임에 Actor Model인가?

온라인 게임의 요구사항과 Actor Model의 특성이 완벽하게 일치합니다:

```
┌─────────────────────────────────────────────────────────────────┐
│              게임 요구사항 vs Actor Model 특성                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   게임 요구사항              Actor Model 특성                    │
│   ─────────────              ───────────────                    │
│   수천 동시 접속자     ◀──▶  수백만 경량 Actor                  │
│   실시간 상호작용      ◀──▶  비동기 메시지 전달                 │
│   엔티티 독립 상태     ◀──▶  Actor 캡슐화 상태                  │
│   장애 격리            ◀──▶  Supervisor 트리                    │
│   수평 확장            ◀──▶  위치 투명성                        │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Microsoft Halo - Orleans 사례

### 아키텍처 개요

```
┌─────────────────────────────────────────────────────────────────┐
│                    Halo 4/5 Backend Architecture                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                    Orleans Silo Cluster                   │   │
│  │                                                           │   │
│  │   ┌─────────────────────────────────────────────────┐    │   │
│  │   │              Player Grain Pool                   │    │   │
│  │   │                                                  │    │   │
│  │   │  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐   │    │   │
│  │   │  │Player 1│ │Player 2│ │Player 3│ │Player N│   │    │   │
│  │   │  │ Grain  │ │ Grain  │ │ Grain  │ │ Grain  │   │    │   │
│  │   │  └────────┘ └────────┘ └────────┘ └────────┘   │    │   │
│  │   └─────────────────────────────────────────────────┘    │   │
│  │                                                           │   │
│  │   ┌───────────┐  ┌───────────┐  ┌───────────┐           │   │
│  │   │Game Grain │  │Match Grain│  │Stats Grain│           │   │
│  │   └───────────┘  └───────────┘  └───────────┘           │   │
│  │                                                           │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  • Virtual Actor: 필요 시 자동 생성/소멸                        │
│  • 투명한 분산: 위치 무관하게 호출                              │
│  • 자동 스케일링: 부하에 따른 동적 확장                         │
└─────────────────────────────────────────────────────────────────┘
```

### Player Grain 구현

```csharp
public interface IPlayerGrain : IGrainWithGuidKey
{
    Task<PlayerState> GetState();
    Task UpdatePresence(PresenceStatus status);
    Task<bool> JoinMatch(Guid matchId);
    Task LeaveMatch();
    Task UpdateStats(GameStats stats);
    Task<List<string>> GetInventory();
    Task<bool> UnlockAchievement(string achievementId);
}

public class PlayerGrain : Grain, IPlayerGrain
{
    private readonly IPersistentState<PlayerState> _state;
    private IMatchGrain? _currentMatch;

    public PlayerGrain(
        [PersistentState("player", "playerStore")]
        IPersistentState<PlayerState> state)
    {
        _state = state;
    }

    public override async Task OnActivateAsync(CancellationToken ct)
    {
        // 플레이어 접속 시 Presence 업데이트
        await UpdatePresence(PresenceStatus.Online);

        // 친구들에게 온라인 알림
        foreach (var friendId in _state.State.FriendIds)
        {
            var friend = GrainFactory.GetGrain<IPlayerGrain>(friendId);
            await friend.NotifyFriendOnline(this.GetPrimaryKey());
        }
    }

    public async Task<bool> JoinMatch(Guid matchId)
    {
        var match = GrainFactory.GetGrain<IMatchGrain>(matchId);
        var result = await match.AddPlayer(this.GetPrimaryKey());

        if (result)
        {
            _currentMatch = match;
            await UpdatePresence(PresenceStatus.InGame);
        }

        return result;
    }

    public async Task UpdateStats(GameStats stats)
    {
        _state.State.TotalKills += stats.Kills;
        _state.State.TotalDeaths += stats.Deaths;
        _state.State.GamesPlayed++;

        // 영속화
        await _state.WriteStateAsync();

        // 업적 체크
        await CheckAchievements();
    }
}
```

### Matchmaking 시스템

```csharp
public interface IMatchmakerGrain : IGrainWithStringKey
{
    Task<Guid?> FindMatch(PlayerMatchRequest request);
    Task CancelSearch(Guid playerId);
}

public class MatchmakerGrain : Grain, IMatchmakerGrain
{
    private readonly Queue<PlayerMatchRequest> _searchQueue = new();
    private IDisposable? _matchTimer;

    public override Task OnActivateAsync(CancellationToken ct)
    {
        // 매칭 틱 (1초마다)
        _matchTimer = RegisterTimer(
            ProcessMatchmaking,
            null,
            TimeSpan.FromSeconds(1),
            TimeSpan.FromSeconds(1)
        );
        return Task.CompletedTask;
    }

    private async Task ProcessMatchmaking(object _)
    {
        while (_searchQueue.Count >= 8)  // 4v4 매치
        {
            var players = Enumerable.Range(0, 8)
                .Select(_ => _searchQueue.Dequeue())
                .ToList();

            // 새 게임 생성
            var matchId = Guid.NewGuid();
            var match = GrainFactory.GetGrain<IMatchGrain>(matchId);

            await match.Initialize(players);

            // 플레이어들에게 알림
            foreach (var player in players)
            {
                var playerGrain = GrainFactory.GetGrain<IPlayerGrain>(player.PlayerId);
                await playerGrain.NotifyMatchFound(matchId);
            }
        }
    }
}
```

## CCP Games - EVE Online

### Stackless Python과 Actor Model

EVE Online은 Stackless Python의 마이크로스레드를 활용한 독자적인 Actor 시스템을 사용합니다:

```
┌─────────────────────────────────────────────────────────────────┐
│                    EVE Online Architecture                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌────────────────────────────────────────────────────────┐     │
│  │                 Solar System (Node)                     │     │
│  │                                                         │     │
│  │   ┌─────────┐  ┌─────────┐  ┌─────────┐              │     │
│  │   │  Ship   │  │  Ship   │  │ Station │              │     │
│  │   │  Actor  │  │  Actor  │  │  Actor  │              │     │
│  │   └────┬────┘  └────┬────┘  └────┬────┘              │     │
│  │        │            │            │                     │     │
│  │   ┌────┴────────────┴────────────┴────┐               │     │
│  │   │         System Manager            │               │     │
│  │   │                                   │               │     │
│  │   │  • 물리 시뮬레이션               │               │     │
│  │   │  • 전투 계산                     │               │     │
│  │   │  • AOI (관심 영역) 관리          │               │     │
│  │   └───────────────────────────────────┘               │     │
│  │                                                         │     │
│  └────────────────────────────────────────────────────────┘     │
│                                                                  │
│  특징:                                                           │
│  • 각 Solar System = 하나의 서버 노드                           │
│  • 수천 플레이어 동시 전투 지원                                  │
│  • Time Dilation (TiDi) 시스템                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Time Dilation (시간 희석)

대규모 전투 시 서버 과부하 해결:

```
정상 상태:
  시간 배율 1.0x
  1초 = 1초 게임 시간

과부하 상태:
  시간 배율 0.1x (10% TiDi)
  1초 = 0.1초 게임 시간

  ┌───────────────────────────────────────────────────────────┐
  │                     Time Dilation                          │
  │                                                            │
  │   부하 ──▶ ████████████████████████████████ ◀── 100%      │
  │             │                                              │
  │             ▼                                              │
  │   TiDi ──▶ ██████████ ◀── 10%                             │
  │                                                            │
  │   효과:                                                    │
  │   • 모든 Actor의 메시지 처리 속도 감소                    │
  │   • 클라이언트와 동기화 유지                              │
  │   • 서버 crash 방지                                        │
  └───────────────────────────────────────────────────────────┘
```

## 게임 서버 설계 패턴

### 1. Entity-Component-Actor 패턴

```
┌─────────────────────────────────────────────────────────────────┐
│                Entity-Component-Actor Pattern                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   ┌────────────────────────────────────────┐                    │
│   │              Entity Actor              │                    │
│   ├────────────────────────────────────────┤                    │
│   │                                        │                    │
│   │   ┌────────────┐  ┌────────────┐      │                    │
│   │   │ Transform  │  │  Physics   │      │                    │
│   │   │ Component  │  │ Component  │      │                    │
│   │   └────────────┘  └────────────┘      │                    │
│   │                                        │                    │
│   │   ┌────────────┐  ┌────────────┐      │                    │
│   │   │  Health    │  │   AI       │      │                    │
│   │   │ Component  │  │ Component  │      │                    │
│   │   └────────────┘  └────────────┘      │                    │
│   │                                        │                    │
│   └────────────────────────────────────────┘                    │
│                                                                  │
│   각 Entity는 독립적 Actor                                       │
│   Component는 Entity 내부 상태                                   │
│   메시지로 Entity 간 상호작용                                    │
└─────────────────────────────────────────────────────────────────┘
```

### 2. Zone/Shard 패턴

```csharp
public interface IZoneGrain : IGrainWithStringKey
{
    Task<bool> PlayerEnter(Guid playerId, Position spawnPoint);
    Task PlayerLeave(Guid playerId);
    Task BroadcastEvent(GameEvent evt, Position origin, float radius);
    Task ProcessTick(float deltaTime);
}

public class ZoneGrain : Grain, IZoneGrain
{
    private readonly Dictionary<Guid, IPlayerGrain> _players = new();
    private readonly SpatialIndex _spatialIndex = new();

    public async Task BroadcastEvent(GameEvent evt, Position origin, float radius)
    {
        // AOI 기반 브로드캐스트
        var nearbyPlayers = _spatialIndex.Query(origin, radius);

        var tasks = nearbyPlayers
            .Select(p => _players[p].ReceiveEvent(evt));

        await Task.WhenAll(tasks);
    }
}
```

### 3. Interest Management

```
┌─────────────────────────────────────────────────────────────────┐
│                   Area of Interest (AOI)                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│       플레이어 시야 범위                                         │
│       ┌─────────────────────┐                                   │
│       │    ○    ●    ○     │    ○ = 시야 외 (업데이트 X)       │
│       │                     │    ● = 시야 내 (업데이트 O)       │
│       │  ○    [P]    ●    │    P = 플레이어                    │
│       │                     │                                    │
│       │    ●    ●    ○     │                                    │
│       └─────────────────────┘                                   │
│                                                                  │
│   구현 방식:                                                     │
│   • 그리드 기반 분할                                             │
│   • 쿼드트리/옥트리                                              │
│   • 동적 반경 조절                                               │
│                                                                  │
│   효과:                                                          │
│   • 네트워크 대역폭 절감 90%+                                   │
│   • 서버 CPU 부하 감소                                          │
└─────────────────────────────────────────────────────────────────┘
```

## 성능 벤치마크

### Orleans 기반 게임 서버

```
┌──────────────────────────────────────────────────────────────┐
│              Orleans Game Server Benchmark                    │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│   동시 접속자:          100,000+                             │
│   메시지 처리량:        500,000 msg/sec                      │
│   평균 지연시간:        < 10ms                               │
│   p99 지연시간:         < 50ms                               │
│   서버 메모리:          ~100 bytes/Grain                     │
│                                                               │
│   테스트 환경:                                                │
│   • 8-core, 32GB RAM                                         │
│   • Azure Standard_D8s_v3                                    │
│   • 3-node cluster                                           │
│                                                               │
└──────────────────────────────────────────────────────────────┘
```

## 실제 구현 예시

[MMORPG 예제 코드](../../examples/06-mmorpg/) 참조

## 참고 자료

- [Orleans and Halo](https://www.microsoft.com/en-us/research/project/orleans-virtual-actors/)
- [EVE Online Server Architecture](https://www.eveonline.com/news/view/tranquility-tech-3)
- [Scalable Game Server Architecture](https://technology.riotgames.com/)
