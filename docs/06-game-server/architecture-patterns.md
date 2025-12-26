# 게임 서버 아키텍처 패턴

> Actor Model 기반 게임 서버 설계 패턴

## 개요

게임 서버에서 Actor Model을 적용할 때 자주 사용되는 아키텍처 패턴들을 소개합니다.

## 1. Entity Actor 패턴

게임 내 엔티티를 Actor로 표현:

```
┌─────────────────────────────────────────────────────────────────┐
│                   Entity Actor Pattern                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   ┌──────────────────────────────────────────────────────────┐  │
│   │                      World                                │  │
│   │                                                           │  │
│   │   ┌─────────┐   ┌─────────┐   ┌─────────┐              │  │
│   │   │ Player  │   │ Monster │   │   NPC   │              │  │
│   │   │  Actor  │   │  Actor  │   │  Actor  │              │  │
│   │   │         │   │         │   │         │              │  │
│   │   │ • HP    │   │ • HP    │   │ • Dialog│              │  │
│   │   │ • Pos   │   │ • AI    │   │ • Quest │              │  │
│   │   │ • Inven │   │ • Loot  │   │         │              │  │
│   │   └─────────┘   └─────────┘   └─────────┘              │  │
│   │                                                           │  │
│   └──────────────────────────────────────────────────────────┘  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

```csharp
public interface IPlayerActor : IGrainWithStringKey
{
    Task<Position> GetPosition();
    Task Move(Direction direction);
    Task Attack(string targetId);
    Task<int> TakeDamage(int amount);
    Task<List<Item>> GetInventory();
}

public class PlayerActor : Grain, IPlayerActor
{
    private PlayerState _state;

    public async Task<int> TakeDamage(int amount)
    {
        _state.HP -= amount;
        if (_state.HP <= 0)
        {
            await HandleDeath();
        }
        await NotifyNearbyPlayers(new DamageEvent(this.GetPrimaryKeyString(), amount));
        return _state.HP;
    }
}
```

## 2. Zone/Shard 패턴

월드를 영역으로 분할하여 관리:

```
┌─────────────────────────────────────────────────────────────────┐
│                    Zone/Shard Pattern                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │                     Game World                           │   │
│   │                                                          │   │
│   │   ┌───────────┐  ┌───────────┐  ┌───────────┐          │   │
│   │   │  Zone 1   │  │  Zone 2   │  │  Zone 3   │          │   │
│   │   │ (Forest)  │  │  (City)   │  │ (Dungeon) │          │   │
│   │   │           │  │           │  │           │          │   │
│   │   │ [Server1] │  │ [Server2] │  │ [Server1] │          │   │
│   │   └───────────┘  └───────────┘  └───────────┘          │   │
│   │        │              │              │                   │   │
│   │        └──────────────┼──────────────┘                   │   │
│   │                       │                                   │   │
│   │              Zone Transition                              │   │
│   │                                                          │   │
│   └─────────────────────────────────────────────────────────┘   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

```csharp
public interface IZoneActor : IGrainWithStringKey
{
    Task<bool> Enter(string playerId, Position position);
    Task Leave(string playerId);
    Task BroadcastToZone(GameEvent evt);
    Task<List<string>> GetPlayersInRadius(Position center, float radius);
}

public class ZoneActor : Grain, IZoneActor
{
    private readonly Dictionary<string, PlayerInfo> _players = new();
    private readonly SpatialIndex _spatialIndex = new();

    public async Task BroadcastToZone(GameEvent evt)
    {
        // AOI 기반 브로드캐스트
        var nearbyPlayers = _spatialIndex.Query(evt.Position, evt.Radius);
        var tasks = nearbyPlayers.Select(p =>
            GrainFactory.GetGrain<IPlayerActor>(p).ReceiveEvent(evt));
        await Task.WhenAll(tasks);
    }
}
```

## 3. Game Room 패턴

매치/세션 기반 게임:

```
┌─────────────────────────────────────────────────────────────────┐
│                    Game Room Pattern                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   ┌──────────────┐          ┌──────────────────────────────┐   │
│   │ Matchmaker   │ ───────▶ │         Game Room            │   │
│   │    Actor     │          │                              │   │
│   └──────────────┘          │   ┌────────┐ ┌────────┐     │   │
│                             │   │Player1 │ │Player2 │     │   │
│   플레이어들을 매칭하고     │   └────────┘ └────────┘     │   │
│   새 게임룸 생성            │                              │   │
│                             │   Game State:                │   │
│                             │   • Turn: Player1            │   │
│                             │   • Board: [...]             │   │
│                             │   • Timer: 30s               │   │
│                             │                              │   │
│                             └──────────────────────────────┘   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

```csharp
public interface IGameRoomActor : IGrainWithGuidKey
{
    Task<bool> Join(string playerId);
    Task Leave(string playerId);
    Task<MoveResult> MakeMove(string playerId, GameMove move);
    Task<GameState> GetState();
}

public class GameRoomActor : Grain, IGameRoomActor
{
    private readonly List<string> _players = new();
    private GameState _state = new();
    private IDisposable? _turnTimer;

    public override Task OnActivateAsync(CancellationToken ct)
    {
        _turnTimer = RegisterTimer(OnTurnTimeout, null,
            TimeSpan.FromSeconds(30), TimeSpan.FromSeconds(30));
        return base.OnActivateAsync(ct);
    }

    public async Task<MoveResult> MakeMove(string playerId, GameMove move)
    {
        if (_state.CurrentTurn != playerId)
            return MoveResult.NotYourTurn;

        _state.ApplyMove(move);

        if (_state.IsGameOver)
        {
            await NotifyGameEnd();
        }
        else
        {
            _state.NextTurn();
            await BroadcastStateUpdate();
        }

        return MoveResult.Success;
    }
}
```

## 4. Command 패턴

게임 액션을 명령 객체로 캡슐화:

```csharp
public interface IGameCommand
{
    string PlayerId { get; }
    Task<CommandResult> Execute(IGameContext context);
    Task Undo(IGameContext context);
}

public class MoveCommand : IGameCommand
{
    public string PlayerId { get; init; }
    public Position From { get; init; }
    public Position To { get; init; }

    public async Task<CommandResult> Execute(IGameContext context)
    {
        var player = context.GetPlayer(PlayerId);
        if (!context.IsValidMove(From, To))
            return CommandResult.InvalidMove;

        player.Position = To;
        await context.BroadcastMovement(PlayerId, From, To);
        return CommandResult.Success;
    }

    public async Task Undo(IGameContext context)
    {
        var player = context.GetPlayer(PlayerId);
        player.Position = From;
        await context.BroadcastMovement(PlayerId, To, From);
    }
}
```

## 5. Tick-Based Update 패턴

고정 간격 게임 루프:

```csharp
public class GameWorldActor : Grain, IGameWorldActor
{
    private IDisposable? _tickTimer;
    private const float TickRate = 1f / 60f; // 60 FPS

    public override Task OnActivateAsync(CancellationToken ct)
    {
        _tickTimer = RegisterTimer(
            OnTick,
            null,
            TimeSpan.Zero,
            TimeSpan.FromSeconds(TickRate));
        return base.OnActivateAsync(ct);
    }

    private async Task OnTick(object state)
    {
        var deltaTime = TickRate;

        // 물리 시뮬레이션
        await UpdatePhysics(deltaTime);

        // AI 업데이트
        await UpdateAI(deltaTime);

        // 상태 동기화
        await SyncState();
    }
}
```

## 6. Event Sourcing 게임 상태

게임 상태를 이벤트로 저장:

```csharp
public interface IGameEvent
{
    DateTime Timestamp { get; }
    string PlayerId { get; }
}

public record PlayerMoved(DateTime Timestamp, string PlayerId, Position To) : IGameEvent;
public record PlayerAttacked(DateTime Timestamp, string PlayerId, string TargetId, int Damage) : IGameEvent;
public record ItemPickedUp(DateTime Timestamp, string PlayerId, string ItemId) : IGameEvent;

public class GameReplayActor : Grain
{
    private readonly List<IGameEvent> _events = new();

    public async Task RecordEvent(IGameEvent evt)
    {
        _events.Add(evt);
        await PersistEvent(evt);
    }

    public async Task<GameState> ReplayTo(DateTime timestamp)
    {
        var state = new GameState();
        foreach (var evt in _events.Where(e => e.Timestamp <= timestamp))
        {
            state.Apply(evt);
        }
        return state;
    }
}
```

## 관련 문서

- [게임 서버 개요](./README.md)
- [실시간 게임 적합성](../07-realtime-game/README.md)
- [MMORPG 예제](../../examples/06-mmorpg/README.md)
