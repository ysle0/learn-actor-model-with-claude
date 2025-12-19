/**
 * MMORPG Server Architecture - C# Orleans Example
 *
 * Orleans 기반 MMORPG 서버 구현 예제
 */

using Orleans;
using Orleans.Runtime;
using System.Collections.Concurrent;

// ============================================
// Data Types
// ============================================

[Serializable]
public record Position(float X, float Y);

[Serializable]
public record PlayerState
{
    public string Id { get; init; } = "";
    public string Name { get; init; } = "";
    public Position Position { get; set; } = new(0, 0);
    public int Health { get; set; } = 100;
    public int MaxHealth { get; init; } = 100;
    public int Level { get; set; } = 1;
    public int Exp { get; set; } = 0;
    public List<string> Inventory { get; init; } = new();
}

[Serializable]
public record MonsterState
{
    public string Id { get; init; } = "";
    public string Type { get; init; } = "";
    public Position Position { get; set; } = new(0, 0);
    public int Health { get; set; } = 100;
    public int MaxHealth { get; init; } = 100;
    public string? AggroTarget { get; set; }
}

[Serializable]
public record CombatResult(bool Hit, int Damage, bool TargetDied);

// ============================================
// Zone Grain Interface
// ============================================

public interface IZoneGrain : IGrainWithStringKey
{
    Task<bool> PlayerEnter(PlayerState player);
    Task PlayerLeave(string playerId);
    Task EntityMove(string entityId, Position newPosition);
    Task<CombatResult> ProcessAttack(string attackerId, string targetId, int damage);
    Task SpawnMonster(string monsterType, Position position);
    Task<List<string>> GetNearbyPlayers(Position position, float radius);
    Task Tick(float deltaTime);
}

// ============================================
// Zone Grain Implementation
// ============================================

public class ZoneGrain : Grain, IZoneGrain
{
    private readonly Dictionary<string, IPlayerGrain> _players = new();
    private readonly Dictionary<string, IMonsterGrain> _monsters = new();
    private readonly float VIEW_RADIUS = 100f;
    private IDisposable? _tickTimer;

    public override Task OnActivateAsync(CancellationToken ct)
    {
        Console.WriteLine($"[Zone {this.GetPrimaryKeyString()}] Activated");

        // 게임 틱 시작 (50ms = 20 ticks/sec)
        _tickTimer = RegisterTimer(
            async _ => await Tick(0.05f),
            null,
            TimeSpan.FromMilliseconds(50),
            TimeSpan.FromMilliseconds(50)
        );

        return base.OnActivateAsync(ct);
    }

    public override Task OnDeactivateAsync(DeactivationReason reason, CancellationToken ct)
    {
        _tickTimer?.Dispose();
        return base.OnDeactivateAsync(reason, ct);
    }

    public async Task<bool> PlayerEnter(PlayerState player)
    {
        var playerGrain = GrainFactory.GetGrain<IPlayerGrain>(player.Id);
        await playerGrain.Initialize(player, this.GetPrimaryKeyString());

        _players[player.Id] = playerGrain;
        Console.WriteLine($"[Zone {this.GetPrimaryKeyString()}] Player {player.Name} entered");

        // 주변 플레이어들에게 알림
        await BroadcastToNearby(player.Position, new PlayerAppeared(player));

        return true;
    }

    public Task PlayerLeave(string playerId)
    {
        if (_players.Remove(playerId))
        {
            Console.WriteLine($"[Zone {this.GetPrimaryKeyString()}] Player {playerId} left");
        }
        return Task.CompletedTask;
    }

    public async Task EntityMove(string entityId, Position newPosition)
    {
        // AOI 기반 업데이트 전파
        await BroadcastToNearby(newPosition, new EntityMoved(entityId, newPosition));
    }

    public async Task<CombatResult> ProcessAttack(string attackerId, string targetId, int damage)
    {
        // 몬스터 공격
        if (_monsters.TryGetValue(targetId, out var monster))
        {
            return await monster.TakeDamage(damage, attackerId);
        }

        // PvP (플레이어 공격)
        if (_players.TryGetValue(targetId, out var player))
        {
            return await player.TakeDamage(damage, attackerId);
        }

        return new CombatResult(false, 0, false);
    }

    public Task SpawnMonster(string monsterType, Position position)
    {
        var id = $"monster_{Guid.NewGuid():N}";
        var monster = GrainFactory.GetGrain<IMonsterGrain>(id);

        var state = new MonsterState
        {
            Id = id,
            Type = monsterType,
            Position = position,
            Health = 100,
            MaxHealth = 100
        };

        _monsters[id] = monster;
        Console.WriteLine($"[Zone {this.GetPrimaryKeyString()}] Spawned {monsterType}");

        return monster.Initialize(state, this.GetPrimaryKeyString());
    }

    public Task<List<string>> GetNearbyPlayers(Position position, float radius)
    {
        // 실제로는 공간 인덱싱 사용
        return Task.FromResult(_players.Keys.ToList());
    }

    public async Task Tick(float deltaTime)
    {
        // 모든 몬스터 AI 업데이트
        var tasks = _monsters.Values.Select(m => m.Tick(deltaTime));
        await Task.WhenAll(tasks);
    }

    public void RemoveMonster(string monsterId)
    {
        _monsters.Remove(monsterId);
    }

    private async Task BroadcastToNearby(Position position, object message)
    {
        var tasks = _players.Values.Select(p => p.ReceiveWorldEvent(message));
        await Task.WhenAll(tasks);
    }
}

// ============================================
// Player Grain Interface
// ============================================

public interface IPlayerGrain : IGrainWithStringKey
{
    Task Initialize(PlayerState state, string zoneId);
    Task Move(Position direction);
    Task<CombatResult> Attack(string targetId);
    Task<CombatResult> TakeDamage(int amount, string attackerId);
    Task GainExp(int amount);
    Task<PlayerState> GetState();
    Task ReceiveWorldEvent(object evt);
}

// ============================================
// Player Grain Implementation
// ============================================

public class PlayerGrain : Grain, IPlayerGrain
{
    private PlayerState _state = new();
    private string _currentZoneId = "";

    public Task Initialize(PlayerState state, string zoneId)
    {
        _state = state;
        _currentZoneId = zoneId;
        return Task.CompletedTask;
    }

    public async Task Move(Position direction)
    {
        _state.Position = new Position(
            _state.Position.X + direction.X,
            _state.Position.Y + direction.Y
        );

        var zone = GrainFactory.GetGrain<IZoneGrain>(_currentZoneId);
        await zone.EntityMove(_state.Id, _state.Position);
    }

    public async Task<CombatResult> Attack(string targetId)
    {
        var damage = 10 + _state.Level * 2;
        var zone = GrainFactory.GetGrain<IZoneGrain>(_currentZoneId);
        return await zone.ProcessAttack(_state.Id, targetId, damage);
    }

    public Task<CombatResult> TakeDamage(int amount, string attackerId)
    {
        _state.Health -= amount;
        Console.WriteLine($"[Player {_state.Name}] HP: {_state.Health}/{_state.MaxHealth}");

        var died = _state.Health <= 0;
        if (died)
        {
            HandleDeath();
        }

        return Task.FromResult(new CombatResult(true, amount, died));
    }

    public Task GainExp(int amount)
    {
        _state.Exp += amount;
        var expToLevel = _state.Level * 100;

        if (_state.Exp >= expToLevel)
        {
            _state.Exp -= expToLevel;
            _state.Level++;
            _state.Health = _state.MaxHealth;
            Console.WriteLine($"[Player {_state.Name}] Level up! Now level {_state.Level}");
        }

        return Task.CompletedTask;
    }

    public Task<PlayerState> GetState() => Task.FromResult(_state);

    public Task ReceiveWorldEvent(object evt)
    {
        // 클라이언트에 이벤트 전달
        // 실제로는 SignalR, WebSocket 등 사용
        Console.WriteLine($"[Player {_state.Name}] Received event: {evt.GetType().Name}");
        return Task.CompletedTask;
    }

    private void HandleDeath()
    {
        Console.WriteLine($"[Player {_state.Name}] Died!");
        // 부활 로직
    }
}

// ============================================
// Monster Grain Interface
// ============================================

public interface IMonsterGrain : IGrainWithStringKey
{
    Task Initialize(MonsterState state, string zoneId);
    Task Tick(float deltaTime);
    Task<CombatResult> TakeDamage(int amount, string attackerId);
}

// ============================================
// Monster Grain Implementation
// ============================================

public class MonsterGrain : Grain, IMonsterGrain
{
    private MonsterState _state = new();
    private string _currentZoneId = "";

    public Task Initialize(MonsterState state, string zoneId)
    {
        _state = state;
        _currentZoneId = zoneId;
        return Task.CompletedTask;
    }

    public Task Tick(float deltaTime)
    {
        if (_state.AggroTarget != null)
        {
            // 타겟 추적 AI
        }
        else
        {
            // 순찰 AI
        }
        return Task.CompletedTask;
    }

    public async Task<CombatResult> TakeDamage(int amount, string attackerId)
    {
        _state.Health -= amount;
        _state.AggroTarget ??= attackerId;

        Console.WriteLine($"[Monster {_state.Type}] HP: {_state.Health}/{_state.MaxHealth}");

        var died = _state.Health <= 0;
        if (died)
        {
            await HandleDeath(attackerId);
        }

        return new CombatResult(true, amount, died);
    }

    private async Task HandleDeath(string killerId)
    {
        Console.WriteLine($"[Monster {_state.Type}] Died!");

        // 경험치 지급
        var killer = GrainFactory.GetGrain<IPlayerGrain>(killerId);
        await killer.GainExp(50);

        // Zone에서 제거 및 리스폰 예약
        // 실제로는 Zone이 관리
    }
}

// ============================================
// Event Types
// ============================================

[Serializable]
public record PlayerAppeared(PlayerState Player);

[Serializable]
public record PlayerDisappeared(string PlayerId);

[Serializable]
public record EntityMoved(string EntityId, Position Position);
