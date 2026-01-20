# FPS/RTS 장르별 패턴

> FPS와 RTS 장르에서 Actor Model을 적용하는 패턴과 아키텍처를 다룹니다.

## 한 줄 요약

**FPS는 Tick 기반 + Actor 보조, RTS는 명령 기반으로 Actor와 자연스럽게 통합**

---

## 장르별 특성 비교

```
┌─────────────────────────────────────────────────────────────────┐
│                   장르별 특성 비교                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│                    FPS               RTS                        │
│  ─────────────────────────────────────────────────────────────  │
│  업데이트 빈도    60-128 Hz          10-30 Hz                   │
│  레이턴시 허용    < 50ms             < 200ms                    │
│  동기화 방식     상태 기반           명령 기반                   │
│  물리 중요도     높음 (필수)         중간 (유닛 충돌)            │
│  엔티티 수       10-100              100-10000                   │
│  네트워크 모델   Server Authority    Lockstep / Server Auth     │
│  Actor 적합성    중간 (보조)         높음 (명령 처리)            │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## FPS 게임 아키텍처

### 전통적 FPS 서버 구조

```
┌─────────────────────────────────────────────────────────────────┐
│                    FPS 서버 아키텍처                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                     Game Server                         │   │
│  │                                                         │   │
│  │  ┌─────────────────────────────────────────────────┐   │   │
│  │  │              Main Game Loop (128Hz)              │   │   │
│  │  │                                                   │   │   │
│  │  │  while (running) {                               │   │   │
│  │  │      inputs = collectClientInputs();             │   │   │
│  │  │      physics.step(inputs);                       │   │   │
│  │  │      gameLogic.update();                         │   │   │
│  │  │      broadcastState();                           │   │   │
│  │  │  }                                               │   │   │
│  │  │                                                   │   │   │
│  │  └─────────────────────────────────────────────────┘   │   │
│  │                                                         │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  Actor 적용 영역:                                               │
│  ─────────────────                                              │
│  • 매치메이킹 시스템                                            │
│  • 로비/채팅                                                    │
│  • 랭킹/통계                                                    │
│  • 플레이어 프로필                                              │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 하이브리드 FPS 아키텍처

```csharp
// FPS 매치 Actor (게임 외적 관리)
public interface IFpsMatchGrain : IGrainWithStringKey
{
    Task<JoinResult> JoinMatch(string playerId);
    Task LeaveMatch(string playerId);
    Task<MatchState> GetMatchState();
    Task StartMatch();
    Task EndMatch(MatchResult result);
}

public class FpsMatchGrain : Grain, IFpsMatchGrain
{
    private readonly List<string> _players = new();
    private MatchState _state = MatchState.Waiting;
    private IGameServerProcess _gameServer;

    public async Task StartMatch()
    {
        if (_players.Count < MinPlayers)
            return;

        _state = MatchState.Starting;

        // 전용 게임 서버 프로세스 시작
        _gameServer = await GameServerManager.AllocateServer(new GameServerConfig
        {
            MatchId = this.GetPrimaryKeyString(),
            Players = _players,
            Map = _selectedMap,
            Mode = _gameMode
        });

        // 플레이어들에게 서버 접속 정보 전달
        foreach (var playerId in _players)
        {
            var player = GrainFactory.GetGrain<IPlayerGrain>(playerId);
            await player.ConnectToGameServer(_gameServer.Address, _gameServer.Port);
        }

        _state = MatchState.InProgress;
    }

    public async Task EndMatch(MatchResult result)
    {
        _state = MatchState.Ended;

        // 결과 처리 (Actor 시스템에서)
        foreach (var playerResult in result.PlayerResults)
        {
            var player = GrainFactory.GetGrain<IPlayerGrain>(playerResult.PlayerId);
            await player.RecordMatchResult(playerResult);
        }

        // 랭킹 업데이트
        var ranking = GrainFactory.GetGrain<IRankingGrain>(0);
        await ranking.UpdateRankings(result);

        // 게임 서버 반환
        await _gameServer.Shutdown();
    }
}

// 전용 게임 서버 (비Actor, Tick 기반)
public class FpsGameServer
{
    private readonly PhysicsEngine _physics;
    private readonly Dictionary<string, PlayerState> _players;
    private readonly int _tickRate = 128;

    public void Run()
    {
        var tickDuration = TimeSpan.FromSeconds(1.0 / _tickRate);

        while (_running)
        {
            var tickStart = DateTime.UtcNow;

            // 입력 수집
            ProcessPendingInputs();

            // 물리 시뮬레이션
            _physics.Step(1.0f / _tickRate);

            // 히트 판정
            ProcessHitDetection();

            // 게임 로직
            UpdateGameLogic();

            // 상태 브로드캐스트
            BroadcastStateSnapshot();

            // 틱 간격 유지
            var elapsed = DateTime.UtcNow - tickStart;
            if (elapsed < tickDuration)
            {
                Thread.Sleep(tickDuration - elapsed);
            }
        }
    }

    private void ProcessHitDetection()
    {
        foreach (var shot in _pendingShots)
        {
            // Raycast 히트 판정
            var hit = _physics.Raycast(shot.Origin, shot.Direction, MaxRange);

            if (hit.EntityId != null && hit.EntityId != shot.ShooterId)
            {
                // 데미지 적용
                var target = _players[hit.EntityId];
                var damage = CalculateDamage(shot.Weapon, hit.Distance, hit.BodyPart);
                target.Health -= damage;

                if (target.Health <= 0)
                {
                    OnPlayerKilled(shot.ShooterId, hit.EntityId);
                }
            }
        }
        _pendingShots.Clear();
    }
}
```

### FPS 네트워크 동기화

```
┌─────────────────────────────────────────────────────────────────┐
│                FPS 네트워크 동기화                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Client                  Server                  Client         │
│  (Shooter)                                       (Target)       │
│  ─────────               ──────                  ───────        │
│                                                                 │
│  T=0: 발사 ───────────────▶                                    │
│       │                     │                                   │
│       │ 로컬 예측           │                                   │
│       │ (즉시 효과)         │                                   │
│       ▼                     │                                   │
│                      T=50ms: 서버 수신                         │
│                             │                                   │
│                      Lag Compensation:                          │
│                      - 타겟의 50ms 전 위치로                   │
│                      - 히트 판정                                │
│                             │                                   │
│                      T=50ms: 히트 확정 ──────────────▶ T=100ms │
│                             │                          피격     │
│       ◀─────────────────────┘                                   │
│  T=100ms: 확정 수신                                             │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## RTS 게임 아키텍처

### Lockstep 동기화

```
┌─────────────────────────────────────────────────────────────────┐
│                   Lockstep 동기화                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  핵심 원리:                                                     │
│  ──────────                                                     │
│  • 모든 클라이언트가 같은 명령을 같은 순서로 실행               │
│  • 결정적(Deterministic) 시뮬레이션                             │
│  • 네트워크로는 명령만 전송 (상태 X)                            │
│                                                                 │
│  Turn 0          Turn 1          Turn 2                        │
│  ───────         ───────         ───────                        │
│                                                                 │
│  Client A: Cmd1 ──▶              Cmd2 ──▶                       │
│  Client B: Cmd3 ──▶              Cmd4 ──▶                       │
│                   │                   │                         │
│                   ▼                   ▼                         │
│  Server:    [Cmd1, Cmd3]        [Cmd2, Cmd4]                   │
│                   │                   │                         │
│                   ▼                   ▼                         │
│  Broadcast ◀──────┴───────────────────┘                         │
│                                                                 │
│  All Clients: 같은 명령 실행 → 같은 결과                        │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### RTS Actor 아키텍처

```csharp
// RTS 게임 세션 Actor
public interface IRtsGameGrain : IGrainWithStringKey
{
    Task<bool> JoinGame(string playerId, int faction);
    Task SubmitCommand(string playerId, int turn, GameCommand command);
    Task<TurnCommands> GetTurnCommands(int turn);
    Task<GameState> GetGameState();
}

public class RtsGameGrain : Grain, IRtsGameGrain
{
    private readonly Dictionary<string, PlayerInfo> _players = new();
    private readonly Dictionary<int, TurnCommands> _turnCommands = new();
    private int _currentTurn = 0;
    private GameState _state;

    private IDisposable _turnTimer;

    public override Task OnActivateAsync(CancellationToken token)
    {
        // Turn 타이머 (200ms = 5 turns/sec)
        _turnTimer = RegisterTimer(
            ProcessTurn,
            null,
            TimeSpan.FromMilliseconds(200),
            TimeSpan.FromMilliseconds(200)
        );

        return base.OnActivateAsync(token);
    }

    public Task SubmitCommand(string playerId, int turn, GameCommand command)
    {
        // 명령 검증
        if (turn < _currentTurn)
            return Task.CompletedTask;  // 너무 늦은 명령

        // 명령 저장
        if (!_turnCommands.ContainsKey(turn))
            _turnCommands[turn] = new TurnCommands();

        _turnCommands[turn].Add(playerId, command);

        return Task.CompletedTask;
    }

    private async Task ProcessTurn(object _)
    {
        var turnToProcess = _currentTurn;

        // 모든 플레이어의 명령이 도착했는지 확인
        if (!_turnCommands.TryGetValue(turnToProcess, out var commands))
        {
            commands = new TurnCommands();
        }

        // 명령 브로드캐스트
        await BroadcastTurnCommands(turnToProcess, commands);

        // 서버에서도 시뮬레이션 (검증용)
        _state = SimulateTurn(_state, commands);

        _currentTurn++;
    }

    private GameState SimulateTurn(GameState state, TurnCommands commands)
    {
        var newState = state.Clone();

        // 명령 정렬 (결정적 순서)
        var sortedCommands = commands.GetAll()
            .OrderBy(c => c.PlayerId)
            .ThenBy(c => c.CommandId);

        foreach (var (playerId, command) in sortedCommands)
        {
            ExecuteCommand(newState, playerId, command);
        }

        // 유닛 AI 업데이트
        foreach (var unit in newState.Units)
        {
            unit.UpdateAI(newState);
        }

        // 물리/충돌
        UpdatePhysics(newState);

        return newState;
    }
}

// 개별 유닛은 Actor가 아님 - GameState 내의 데이터
public class Unit
{
    public string UnitId { get; set; }
    public string OwnerId { get; set; }
    public UnitType Type { get; set; }
    public Vector2 Position { get; set; }
    public float Health { get; set; }
    public UnitState State { get; set; }
    public Queue<UnitCommand> CommandQueue { get; set; }

    public void UpdateAI(GameState world)
    {
        switch (State)
        {
            case UnitState.Idle:
                // 근처 적 탐색
                var nearbyEnemy = FindNearestEnemy(world);
                if (nearbyEnemy != null && Distance(Position, nearbyEnemy.Position) < AttackRange)
                {
                    State = UnitState.Attacking;
                    Target = nearbyEnemy.UnitId;
                }
                break;

            case UnitState.Moving:
                // 목표 지점으로 이동
                MoveTowards(TargetPosition);
                if (Distance(Position, TargetPosition) < 1f)
                {
                    State = UnitState.Idle;
                }
                break;

            case UnitState.Attacking:
                // 공격 처리
                ProcessAttack(world);
                break;
        }
    }
}
```

### Server Authority RTS

```csharp
// 서버 권위 RTS (Lockstep 대안)
public class ServerAuthorityRtsGrain : Grain, IRtsGameGrain
{
    private GameState _serverState;
    private readonly Dictionary<string, List<GameCommand>> _pendingCommands = new();

    // 클라이언트 명령 수신 (비동기)
    public Task SubmitCommand(string playerId, GameCommand command)
    {
        // 명령 검증
        if (!ValidateCommand(playerId, command))
            return Task.CompletedTask;

        if (!_pendingCommands.ContainsKey(playerId))
            _pendingCommands[playerId] = new List<GameCommand>();

        _pendingCommands[playerId].Add(command);

        return Task.CompletedTask;
    }

    // 서버 Tick (10Hz)
    private async Task OnServerTick(object _)
    {
        // 모든 대기 명령 처리
        foreach (var (playerId, commands) in _pendingCommands)
        {
            foreach (var command in commands)
            {
                ExecuteCommand(_serverState, playerId, command);
            }
            commands.Clear();
        }

        // 게임 로직 업데이트
        UpdateGameLogic(_serverState);

        // 델타 상태 브로드캐스트
        var delta = CalculateDelta(_lastBroadcastState, _serverState);
        await BroadcastStateDelta(delta);

        _lastBroadcastState = _serverState.Clone();
    }
}
```

---

## 대규모 전투 처리

### 유닛 그룹화

```
┌─────────────────────────────────────────────────────────────────┐
│                   대규모 전투 최적화                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  문제: 1000 vs 1000 유닛 전투                                   │
│  → 개별 처리 시 1,000,000 상호작용/tick                        │
│                                                                 │
│  해결: 유닛 그룹화 (Squad/Battalion)                            │
│                                                                 │
│  개별 유닛:                      그룹화:                        │
│  ○ ○ ○ ○ ○ ○ ○ ○              ┌─────────────┐                 │
│  ○ ○ ○ ○ ○ ○ ○ ○              │  Squad A    │                 │
│  ○ ○ ○ ○ ○ ○ ○ ○      →       │  (64 units) │                 │
│  ○ ○ ○ ○ ○ ○ ○ ○              │  Aggregate  │                 │
│  (64개 개별 처리)              │  Stats      │                 │
│                                └─────────────┘                 │
│                                                                 │
│  Squad 레벨에서:                                                │
│  • 이동: 중심점 + 대형                                         │
│  • 전투: 집계된 DPS vs 집계된 HP                               │
│  • 개별 유닛은 시각적 표현만                                    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

```csharp
// Squad 기반 처리
public class Squad
{
    public string SquadId { get; set; }
    public string OwnerId { get; set; }
    public List<Unit> Units { get; set; }

    // 집계 통계
    public int TotalHealth => Units.Sum(u => u.Health);
    public float AverageDPS => Units.Average(u => u.DPS);
    public Vector2 CenterPosition => CalculateCenter();

    public void ProcessCombat(Squad enemySquad)
    {
        // Squad 레벨 전투 (단순화)
        var myDamage = AverageDPS * Units.Count * DeltaTime;
        var enemyDamage = enemySquad.AverageDPS * enemySquad.Units.Count * DeltaTime;

        // 피해 분배
        DistributeDamage(enemyDamage);
        enemySquad.DistributeDamage(myDamage);
    }

    public void Move(Vector2 target)
    {
        // Squad 중심점만 이동
        var direction = (target - CenterPosition).Normalized();
        var newCenter = CenterPosition + direction * MoveSpeed * DeltaTime;

        // 개별 유닛 위치는 대형에 따라 계산
        UpdateUnitPositions(newCenter);
    }
}
```

---

## 안개 전쟁 (Fog of War)

```csharp
// 시야 시스템
public class FogOfWarSystem
{
    private readonly byte[,] _visibilityMap;  // 0=안보임, 1=탐사됨, 2=보임
    private readonly Dictionary<string, HashSet<(int, int)>> _playerVisibility;

    public void UpdateVisibility(GameState state)
    {
        // 각 플레이어의 시야 초기화 (탐사된 곳은 유지)
        foreach (var playerId in _playerVisibility.Keys)
        {
            var visible = _playerVisibility[playerId];
            visible.Clear();
        }

        // 각 유닛의 시야 계산
        foreach (var unit in state.Units)
        {
            var cells = GetVisibleCells(unit.Position, unit.SightRange);
            _playerVisibility[unit.OwnerId].UnionWith(cells);
        }
    }

    public GameState FilterStateForPlayer(GameState fullState, string playerId)
    {
        var visibleCells = _playerVisibility[playerId];

        return new GameState
        {
            // 자기 유닛은 모두 보임
            MyUnits = fullState.Units.Where(u => u.OwnerId == playerId).ToList(),

            // 적 유닛은 시야 내만
            EnemyUnits = fullState.Units
                .Where(u => u.OwnerId != playerId)
                .Where(u => IsVisible(u.Position, visibleCells))
                .Select(u => u.ToVisibleState())  // 일부 정보만
                .ToList(),

            // 자원/건물도 시야 내만
            Resources = fullState.Resources
                .Where(r => IsVisible(r.Position, visibleCells))
                .ToList()
        };
    }
}

// Actor에서 상태 전송 시
public async Task BroadcastState()
{
    foreach (var playerId in _players.Keys)
    {
        // 플레이어별 필터링된 상태 전송
        var filteredState = _fogOfWar.FilterStateForPlayer(_state, playerId);
        var player = GrainFactory.GetGrain<IPlayerGrain>(playerId);
        await player.ReceiveGameState(filteredState);
    }
}
```

---

## 장르별 권장 사항

```
┌─────────────────────────────────────────────────────────────────┐
│                   장르별 권장 사항                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  FPS:                                                          │
│  ─────                                                          │
│  • 게임플레이: 전용 서버 (Tick 기반, 128Hz)                     │
│  • 매칭/로비: Actor (Orleans, Akka)                             │
│  • 통계/랭킹: Actor                                             │
│  • 채팅: Actor                                                  │
│                                                                 │
│  RTS:                                                          │
│  ─────                                                          │
│  • 소규모 (1v1, 2v2): Lockstep + Actor 세션 관리               │
│  • 대규모: Server Authority + Actor                            │
│  • 리플레이: 명령 로그 저장 (Event Sourcing)                    │
│                                                                 │
│  MOBA:                                                          │
│  ─────                                                          │
│  • 게임플레이: 하이브리드 (Tick + Actor)                        │
│  • 물리: 서버 권위                                              │
│  • 스킬 시스템: Actor 가능 (10 플레이어)                        │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 다음 단계

- [../06-game-server/README.md](../06-game-server/README.md) - 게임 서버 개요
- [mmo-architecture.md](./mmo-architecture.md) - MMO 아키텍처
- [physics-simulation.md](./physics-simulation.md) - 물리 시뮬레이션
