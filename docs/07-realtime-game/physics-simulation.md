# 물리 시뮬레이션과 Actor Model

> 물리 시뮬레이션을 Actor Model과 통합하는 방법과 아키텍처 패턴을 다룹니다.

## 한 줄 요약

**물리 엔진은 Tick 기반 단일 시스템으로, Actor는 물리 결과를 받아 게임 로직에 적용**

---

## 물리 시뮬레이션의 특성

```
┌─────────────────────────────────────────────────────────────────┐
│               물리 시뮬레이션 특성                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  요구사항:                                                       │
│  ──────────                                                     │
│  • 결정적(Deterministic): 같은 입력 → 같은 결과                 │
│  • 고빈도 업데이트: 30-120 Hz                                   │
│  • 순차적 처리: 충돌 해결은 순서 의존적                          │
│  • 낮은 레이턴시: 프레임 내 완료 필요                            │
│                                                                 │
│  Actor Model과의 충돌:                                           │
│  ─────────────────────                                          │
│  ❌ 비동기 메시지 패싱 → 타이밍 불확실                          │
│  ❌ 분산 처리 → 순서 보장 어려움                                │
│  ❌ 메시지 오버헤드 → 60fps × 1000 오브젝트 = 문제              │
│                                                                 │
│  결론: 물리 엔진 자체는 Actor로 만들지 않음                      │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 권장 아키텍처

### 물리 엔진 분리 패턴

```
┌─────────────────────────────────────────────────────────────────┐
│                물리 엔진 분리 아키텍처                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                   Actor System                          │   │
│  │                                                         │   │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐               │   │
│  │  │ Player  │  │  Game   │  │  Chat   │   ...         │   │
│  │  │ Actors  │  │  Logic  │  │  Actor  │               │   │
│  │  └────┬────┘  └────┬────┘  └─────────┘               │   │
│  │       │            │                                   │   │
│  │       │    ┌───────┴───────┐                          │   │
│  │       │    │  Physics      │                          │   │
│  │       └───▶│  Interface    │◀─── 결과 수신             │   │
│  │            │  Actor        │                          │   │
│  │            └───────┬───────┘                          │   │
│  └────────────────────┼────────────────────────────────────┘   │
│                       │                                        │
│                       │ 동기 호출 또는                         │
│                       │ 전용 스레드                            │
│                       ▼                                        │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                Physics Engine                           │   │
│  │            (단일 스레드, Tick 기반)                      │   │
│  │                                                         │   │
│  │  • Bullet Physics                                       │   │
│  │  • Box2D                                                │   │
│  │  • PhysX                                                │   │
│  │  • 자체 구현                                            │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 구현 예시

```csharp
// 물리 인터페이스 Actor
public interface IPhysicsGrain : IGrainWithIntegerKey
{
    Task<PhysicsState> SimulateTick(
        float deltaTime,
        List<PhysicsInput> inputs
    );
    Task AddBody(string entityId, PhysicsBodyDesc desc);
    Task RemoveBody(string entityId);
    Task ApplyForce(string entityId, Vector3 force);
    Task<RaycastResult> Raycast(Vector3 origin, Vector3 direction, float maxDistance);
}

public class PhysicsGrain : Grain, IPhysicsGrain
{
    private PhysicsWorld _world;  // 실제 물리 엔진 래퍼
    private readonly Dictionary<string, PhysicsBody> _bodies = new();

    public override Task OnActivateAsync(CancellationToken token)
    {
        _world = new PhysicsWorld(new PhysicsConfig
        {
            Gravity = new Vector3(0, -9.81f, 0),
            FixedTimeStep = 1f / 60f
        });
        return base.OnActivateAsync(token);
    }

    public Task<PhysicsState> SimulateTick(
        float deltaTime,
        List<PhysicsInput> inputs)
    {
        // 입력 적용
        foreach (var input in inputs)
        {
            if (_bodies.TryGetValue(input.EntityId, out var body))
            {
                switch (input.Type)
                {
                    case PhysicsInputType.Force:
                        body.ApplyForce(input.Force);
                        break;
                    case PhysicsInputType.Impulse:
                        body.ApplyImpulse(input.Impulse);
                        break;
                    case PhysicsInputType.Teleport:
                        body.SetPosition(input.Position);
                        break;
                }
            }
        }

        // 물리 시뮬레이션 스텝
        _world.Step(deltaTime);

        // 결과 수집
        var state = new PhysicsState
        {
            BodyStates = _bodies.ToDictionary(
                kvp => kvp.Key,
                kvp => new BodyState
                {
                    Position = kvp.Value.Position,
                    Rotation = kvp.Value.Rotation,
                    Velocity = kvp.Value.Velocity
                }
            ),
            Collisions = _world.GetCollisions()
        };

        return Task.FromResult(state);
    }

    public Task<RaycastResult> Raycast(
        Vector3 origin,
        Vector3 direction,
        float maxDistance)
    {
        var result = _world.Raycast(origin, direction, maxDistance);
        return Task.FromResult(result);
    }
}
```

### Game Loop에서 물리 호출

```csharp
// 게임룸에서 물리 통합
public class GameRoomGrain : Grain, IGameRoomGrain
{
    private readonly IPhysicsGrain _physics;
    private readonly Dictionary<string, PlayerState> _players;
    private readonly List<PhysicsInput> _pendingPhysicsInputs = new();

    private IDisposable _tickTimer;

    public override async Task OnActivateAsync(CancellationToken token)
    {
        // 물리 Grain 획득 (또는 로컬 물리 엔진 사용)
        _physics = GrainFactory.GetGrain<IPhysicsGrain>(
            this.GetPrimaryKeyLong()  // 같은 ID로 물리 Grain 연결
        );

        // 60fps 게임 루프
        _tickTimer = RegisterTimer(
            OnGameTick,
            null,
            TimeSpan.FromMilliseconds(16),
            TimeSpan.FromMilliseconds(16)
        );

        await base.OnActivateAsync(token);
    }

    public Task OnPlayerInput(string playerId, PlayerInput input)
    {
        // 이동 입력 → 물리 입력으로 변환
        if (input.MovementDirection != Vector3.Zero)
        {
            _pendingPhysicsInputs.Add(new PhysicsInput
            {
                EntityId = playerId,
                Type = PhysicsInputType.Force,
                Force = input.MovementDirection * MoveForce
            });
        }

        return Task.CompletedTask;
    }

    private async Task OnGameTick(object _)
    {
        // 1. 물리 시뮬레이션
        var physicsState = await _physics.SimulateTick(
            0.016f,
            _pendingPhysicsInputs
        );
        _pendingPhysicsInputs.Clear();

        // 2. 물리 결과를 게임 상태에 반영
        foreach (var (entityId, bodyState) in physicsState.BodyStates)
        {
            if (_players.TryGetValue(entityId, out var player))
            {
                player.Position = bodyState.Position;
                player.Velocity = bodyState.Velocity;
            }
        }

        // 3. 충돌 처리 (게임 로직)
        foreach (var collision in physicsState.Collisions)
        {
            await HandleCollision(collision);
        }

        // 4. 상태 브로드캐스트
        await BroadcastGameState();
    }

    private async Task HandleCollision(CollisionInfo collision)
    {
        // 물리 충돌 → 게임 이벤트로 변환
        if (collision.BodyA.StartsWith("projectile_"))
        {
            await HandleProjectileHit(collision);
        }
        else if (collision.BodyA.StartsWith("player_") &&
                 collision.BodyB.StartsWith("pickup_"))
        {
            await HandlePickup(collision);
        }
    }
}
```

---

## 물리 분리 패턴

### 1. 프로세스 내 분리

```
┌─────────────────────────────────────────────────────────────────┐
│                  프로세스 내 분리                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌────────────────────── Process ─────────────────────────┐    │
│  │                                                         │    │
│  │   Thread 1: Actor System          Thread 2: Physics    │    │
│  │   ┌─────────────────────┐        ┌────────────────┐   │    │
│  │   │  Game Actors        │◀──────▶│ Physics Engine │   │    │
│  │   │  • GameRoom         │ Queue  │ • World        │   │    │
│  │   │  • Players          │        │ • Bodies       │   │    │
│  │   └─────────────────────┘        └────────────────┘   │    │
│  │                                                         │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                 │
│  장점: 낮은 레이턴시, 단순한 구조                               │
│  단점: 스케일 제한                                              │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

```cpp
// C++에서 물리 스레드 분리
class GameServer {
    std::thread physics_thread;
    std::atomic<bool> running{true};

    // Actor → Physics 명령 큐
    moodycamel::ConcurrentQueue<PhysicsCommand> command_queue;

    // Physics → Actor 결과 큐
    moodycamel::ConcurrentQueue<PhysicsResult> result_queue;

    void physics_loop() {
        btDefaultCollisionConfiguration config;
        btCollisionDispatcher dispatcher(&config);
        btDbvtBroadphase broadphase;
        btSequentialImpulseConstraintSolver solver;
        btDiscreteDynamicsWorld world(&dispatcher, &broadphase,
                                      &solver, &config);

        auto last_time = std::chrono::steady_clock::now();

        while (running) {
            auto now = std::chrono::steady_clock::now();
            float dt = std::chrono::duration<float>(now - last_time).count();
            last_time = now;

            // 명령 처리
            PhysicsCommand cmd;
            while (command_queue.try_dequeue(cmd)) {
                process_command(world, cmd);
            }

            // 물리 스텝
            world.stepSimulation(dt, 10);

            // 결과 전송
            PhysicsResult result = collect_state(world);
            result_queue.enqueue(std::move(result));

            // 60fps 유지
            std::this_thread::sleep_until(now + std::chrono::milliseconds(16));
        }
    }

    // Actor에서 호출
    void apply_force(entity_id id, vec3 force) {
        command_queue.enqueue(PhysicsCommand{
            .type = CommandType::ApplyForce,
            .entity_id = id,
            .force = force
        });
    }

    // Actor의 tick에서 호출
    std::optional<PhysicsResult> poll_physics_result() {
        PhysicsResult result;
        if (result_queue.try_dequeue(result)) {
            return result;
        }
        return std::nullopt;
    }
};
```

### 2. Zone별 물리 인스턴스

```
┌─────────────────────────────────────────────────────────────────┐
│                Zone별 물리 인스턴스                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Zone 1                        Zone 2                          │
│  ┌────────────────────┐       ┌────────────────────┐          │
│  │  ZoneActor 1       │       │  ZoneActor 2       │          │
│  │  ┌──────────────┐  │       │  ┌──────────────┐  │          │
│  │  │PhysicsEngine │  │       │  │PhysicsEngine │  │          │
│  │  │  (독립 월드) │  │       │  │  (독립 월드) │  │          │
│  │  └──────────────┘  │       │  └──────────────┘  │          │
│  │  Players: 100      │       │  Players: 150      │          │
│  └────────────────────┘       └────────────────────┘          │
│                                                                 │
│  장점:                                                         │
│  • Zone별 독립적 스케일링                                      │
│  • 장애 격리                                                   │
│  • Zone 크기에 맞는 물리 최적화                                │
│                                                                 │
│  단점:                                                         │
│  • Zone 경계에서의 물리 연속성 문제                            │
│  • 메모리 사용량 증가                                          │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 서버 권위 물리 vs 클라이언트 예측

### 서버 권위 물리

```
┌─────────────────────────────────────────────────────────────────┐
│                   서버 권위 물리                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Client               Server                                    │
│  ──────               ──────                                    │
│                                                                 │
│  입력 전송 ─────────────▶ 입력 수신                            │
│                          ▼                                      │
│                       물리 시뮬레이션                           │
│                          ▼                                      │
│  결과 수신 ◀───────────── 결과 전송                            │
│                                                                 │
│  장점:                                                         │
│  • 완벽한 일관성                                               │
│  • 치팅 방지                                                   │
│  • 단순한 클라이언트                                           │
│                                                                 │
│  단점:                                                         │
│  • 입력 지연 (RTT만큼)                                         │
│  • 반응성 저하                                                 │
│                                                                 │
│  적합: 턴제, 느린 게임, 보안 중요                              │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 클라이언트 예측 + 서버 검증

```
┌─────────────────────────────────────────────────────────────────┐
│               클라이언트 예측 + 서버 검증                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Client                              Server                     │
│  ──────                              ──────                     │
│                                                                 │
│  입력 발생                                                      │
│     │                                                           │
│     ├──▶ 로컬 예측 (즉시)                                      │
│     │    물리 시뮬레이션                                        │
│     │    화면 업데이트                                          │
│     │                                                           │
│     └──────────────────────────────▶ 입력 수신                 │
│                                         │                       │
│                                         ▼                       │
│                                      서버 물리                  │
│                                         │                       │
│  서버 상태 수신 ◀───────────────────────┘                       │
│     │                                                           │
│     ▼                                                           │
│  예측과 비교                                                    │
│     │                                                           │
│     ├─ 일치: 유지                                              │
│     └─ 불일치: 보정 (스냅 또는 보간)                           │
│                                                                 │
│  장점: 즉각적 반응, 좋은 사용자 경험                           │
│  단점: 복잡한 구현, 롤백 필요                                  │
│  적합: FPS, 액션 게임                                          │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

```csharp
// 서버: 물리 검증
public class AuthoritativePhysicsServer
{
    private readonly PhysicsWorld _world;
    private readonly Dictionary<string, InputBuffer> _inputBuffers;

    public PhysicsState ProcessTick(int serverTick)
    {
        // 각 플레이어의 해당 틱 입력 적용
        foreach (var (playerId, buffer) in _inputBuffers)
        {
            if (buffer.TryGetInput(serverTick, out var input))
            {
                ApplyInput(playerId, input);
            }
        }

        // 물리 스텝
        _world.Step(FixedDeltaTime);

        return CollectState();
    }

    public void OnClientInput(string playerId, int clientTick, PlayerInput input)
    {
        // 입력 버퍼에 저장
        _inputBuffers[playerId].AddInput(clientTick, input);

        // 치팅 감지: 비정상적인 입력 체크
        if (IsInputSuspicious(playerId, input))
        {
            FlagForReview(playerId);
        }
    }
}

// 클라이언트: 예측 + 보정
public class ClientSidePrediction
{
    private readonly PhysicsWorld _localWorld;
    private readonly Queue<PredictedState> _predictions;
    private int _lastServerTick;

    public void OnLocalInput(PlayerInput input)
    {
        // 1. 로컬 예측
        ApplyInput(input);
        _localWorld.Step(FixedDeltaTime);

        // 2. 예측 저장
        _predictions.Enqueue(new PredictedState
        {
            Tick = _currentTick,
            Input = input,
            State = GetPlayerState()
        });

        // 3. 서버로 전송
        SendToServer(input, _currentTick);
    }

    public void OnServerState(int serverTick, PhysicsState serverState)
    {
        // 예측 검증
        while (_predictions.Count > 0 &&
               _predictions.Peek().Tick <= serverTick)
        {
            var prediction = _predictions.Dequeue();

            if (prediction.Tick == serverTick)
            {
                // 비교
                var serverPlayerState = serverState.GetPlayer(_playerId);
                var error = CalculateError(prediction.State, serverPlayerState);

                if (error > ErrorThreshold)
                {
                    // 보정 필요
                    Reconcile(serverState, serverTick);
                }
            }
        }

        _lastServerTick = serverTick;
    }

    private void Reconcile(PhysicsState serverState, int serverTick)
    {
        // 1. 서버 상태로 리셋
        SetState(serverState);

        // 2. 이후 입력 재적용
        foreach (var prediction in _predictions.Where(p => p.Tick > serverTick))
        {
            ApplyInput(prediction.Input);
            _localWorld.Step(FixedDeltaTime);
        }
    }
}
```

---

## 발사체/충돌 처리

### 발사체를 Actor로?

```
┌─────────────────────────────────────────────────────────────────┐
│               발사체 처리 전략                                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ❌ 각 발사체를 Actor로:                                        │
│     • 총알 100개 = Actor 100개                                 │
│     • 메시지 오버헤드 폭발                                     │
│     • 절대 권장하지 않음                                       │
│                                                                 │
│  ✅ Zone/Room Actor가 발사체 관리:                              │
│     • 발사체 목록을 상태로 보유                                │
│     • Tick마다 일괄 업데이트                                   │
│     • 충돌은 물리 엔진에서 처리                                │
│                                                                 │
│  ✅ 히트스캔 (즉시 판정):                                       │
│     • Raycast로 즉시 판정                                      │
│     • 발사체 오브젝트 없음                                     │
│     • FPS에서 주로 사용                                        │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

```csharp
// Zone에서 발사체 관리
public class ZoneGrain
{
    private readonly List<Projectile> _projectiles = new();

    public Task FireProjectile(string shooterId, Vector3 origin, Vector3 direction)
    {
        _projectiles.Add(new Projectile
        {
            Id = Guid.NewGuid().ToString(),
            OwnerId = shooterId,
            Position = origin,
            Velocity = direction * ProjectileSpeed,
            CreatedAt = DateTime.UtcNow
        });

        return Task.CompletedTask;
    }

    private void UpdateProjectiles(float dt)
    {
        var toRemove = new List<Projectile>();

        foreach (var projectile in _projectiles)
        {
            // 이동
            projectile.Position += projectile.Velocity * dt;

            // 충돌 체크 (물리 엔진 또는 직접)
            var hit = CheckCollision(projectile);
            if (hit != null)
            {
                HandleProjectileHit(projectile, hit);
                toRemove.Add(projectile);
            }

            // 수명 체크
            if ((DateTime.UtcNow - projectile.CreatedAt).TotalSeconds > MaxLifetime)
            {
                toRemove.Add(projectile);
            }
        }

        foreach (var p in toRemove)
        {
            _projectiles.Remove(p);
        }
    }

    // 히트스캔 방식
    public Task<HitResult> FireHitscan(
        string shooterId,
        Vector3 origin,
        Vector3 direction)
    {
        var result = _physics.Raycast(origin, direction, MaxRange);

        if (result.Hit && result.EntityId != shooterId)
        {
            // 피격 처리
            ApplyDamage(result.EntityId, CalculateDamage(result.Distance));
            return Task.FromResult(new HitResult { Hit = true, Target = result.EntityId });
        }

        return Task.FromResult(new HitResult { Hit = false });
    }
}
```

---

## 성능 최적화

### 물리 LOD (Level of Detail)

```csharp
// 거리에 따른 물리 정밀도 조절
public class PhysicsLOD
{
    public void UpdateEntity(Entity entity, float distanceFromPlayer)
    {
        if (distanceFromPlayer < 50f)
        {
            // 가까움: 풀 물리
            entity.PhysicsMode = PhysicsMode.Full;
            entity.UpdateRate = 60;  // 60Hz
        }
        else if (distanceFromPlayer < 200f)
        {
            // 중간: 간소화된 물리
            entity.PhysicsMode = PhysicsMode.Simplified;
            entity.UpdateRate = 20;  // 20Hz
        }
        else
        {
            // 멀리: 물리 비활성화
            entity.PhysicsMode = PhysicsMode.None;
            entity.UpdateRate = 5;   // 5Hz (위치만)
        }
    }
}
```

### 물리 그룹화

```
시야 내 100개 객체를 개별 처리하지 않고
"물리 그룹"으로 묶어서 처리:

개별 처리: 100 bodies × 60Hz = 6000 updates/sec
그룹 처리: 10 groups × 60Hz = 600 updates/sec

그룹 내부는 단순화된 물리 또는 보간
```

---

## 다음 단계

- [fps-rts-patterns.md](./fps-rts-patterns.md) - FPS/RTS 장르별 패턴
- [tick-based-vs-event.md](./tick-based-vs-event.md) - Tick vs 이벤트 설계
- [mmo-architecture.md](./mmo-architecture.md) - MMO 아키텍처
