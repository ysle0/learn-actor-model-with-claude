# Tick 기반 vs 이벤트 기반 설계

> 게임 서버 설계에서 Tick 기반과 이벤트 기반 접근법을 비교하고 Actor Model과의 조합을 분석합니다.

## 한 줄 요약

**Tick 기반은 동기화/물리에, 이벤트 기반은 상태 관리에 적합 - 실제로는 하이브리드 사용**

---

## 두 가지 접근법 개요

```
┌─────────────────────────────────────────────────────────────────┐
│                    Tick 기반 vs 이벤트 기반                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Tick 기반 (Game Loop)                                          │
│  ─────────────────────                                          │
│  • 고정 간격으로 모든 상태 업데이트                              │
│  • 예: 60fps = 16.67ms마다 한 번                                │
│  • 전통적인 게임 엔진 방식                                       │
│                                                                 │
│  while (running) {                                              │
│      processInput();                                            │
│      updateGameState(deltaTime);                                │
│      render();  // 서버에서는 브로드캐스트                       │
│      sleep(until_next_tick);                                    │
│  }                                                              │
│                                                                 │
│  ─────────────────────────────────────────────────────────────  │
│                                                                 │
│  이벤트 기반 (Event-Driven)                                      │
│  ─────────────────────────                                      │
│  • 이벤트 발생 시에만 처리                                       │
│  • 상태 변경이 없으면 CPU 유휴                                   │
│  • Actor Model의 기본 방식                                       │
│                                                                 │
│  while (running) {                                              │
│      event = waitForEvent();  // 블로킹                         │
│      processEvent(event);                                       │
│      notifySubscribers();                                       │
│  }                                                              │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 상세 비교

### Tick 기반 설계

```
┌─────────────────────────────────────────────────────────────────┐
│                    Tick 기반 설계                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  처리 흐름:                                                      │
│  ──────────                                                     │
│  Time: 0ms     16ms    32ms    48ms    64ms                     │
│        │       │       │       │       │                        │
│        ▼       ▼       ▼       ▼       ▼                        │
│       Tick1   Tick2   Tick3   Tick4   Tick5                     │
│        │       │       │       │       │                        │
│        └───────┴───────┴───────┴───────┘                        │
│                        │                                        │
│                    매 Tick마다:                                  │
│                    • 모든 엔티티 위치 업데이트                   │
│                    • 충돌 감지                                   │
│                    • AI 판단                                    │
│                    • 상태 브로드캐스트                           │
│                                                                 │
│  장점:                                                          │
│  ──────                                                         │
│  ✅ 예측 가능한 타이밍                                           │
│  ✅ 물리 시뮬레이션에 적합                                       │
│  ✅ 결정적(Deterministic) 실행 가능                              │
│  ✅ 동기화 로직 단순                                             │
│                                                                 │
│  단점:                                                          │
│  ──────                                                         │
│  ❌ 유휴 시에도 CPU 사용                                         │
│  ❌ 스케일링 어려움 (고정 루프)                                  │
│  ❌ 서버 확장 시 동기화 복잡                                     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

```cpp
// Tick 기반 게임 루프 예시
class GameServer {
    static constexpr auto TICK_RATE = 60;  // 60 Hz
    static constexpr auto TICK_DURATION =
        std::chrono::milliseconds(1000 / TICK_RATE);

    void run() {
        auto last_tick = std::chrono::steady_clock::now();

        while (running) {
            auto now = std::chrono::steady_clock::now();
            auto delta = now - last_tick;

            if (delta >= TICK_DURATION) {
                // 입력 처리
                process_all_pending_inputs();

                // 게임 상태 업데이트
                float dt = std::chrono::duration<float>(delta).count();
                update_physics(dt);
                update_ai(dt);
                update_game_logic(dt);

                // 클라이언트에 브로드캐스트
                broadcast_state_snapshot();

                last_tick = now;
            }

            // 다음 틱까지 대기 (CPU 절약)
            std::this_thread::sleep_until(
                last_tick + TICK_DURATION
            );
        }
    }

    void process_all_pending_inputs() {
        while (!input_queue.empty()) {
            auto input = input_queue.pop();
            // 다음 틱에 적용할 입력 저장
            pending_actions[input.player_id].push(input.action);
        }
    }
};
```

### 이벤트 기반 설계

```
┌─────────────────────────────────────────────────────────────────┐
│                   이벤트 기반 설계                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  처리 흐름:                                                      │
│  ──────────                                                     │
│  Time: ──●─────────●────●──────────────●─────                   │
│          │         │    │              │                        │
│          ▼         ▼    ▼              ▼                        │
│       Event1    Event2 Event3       Event4                      │
│                                                                 │
│  • 이벤트가 있을 때만 처리                                       │
│  • 이벤트 없으면 대기 (CPU 유휴)                                 │
│                                                                 │
│  장점:                                                          │
│  ──────                                                         │
│  ✅ 효율적인 리소스 사용                                         │
│  ✅ 자연스러운 수평 확장                                         │
│  ✅ Actor Model과 잘 맞음                                        │
│  ✅ 비동기 처리에 적합                                           │
│                                                                 │
│  단점:                                                          │
│  ──────                                                         │
│  ❌ 동기화 복잡                                                  │
│  ❌ 물리 시뮬레이션에 부적합                                     │
│  ❌ 타이밍 일관성 없음                                           │
│  ❌ 브로드캐스트 시점 결정 어려움                                │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

```csharp
// 이벤트 기반 Actor 예시 (Orleans)
public class GameRoomGrain : Grain, IGameRoomGrain
{
    private GameState _state;

    // 이벤트 발생 시에만 처리
    public async Task<ActionResult> ProcessAction(
        string playerId, GameAction action)
    {
        // 액션 검증
        if (!IsValidAction(action))
            return ActionResult.Invalid;

        // 상태 업데이트
        _state = ApplyAction(_state, playerId, action);

        // 관련 플레이어에게만 알림
        await NotifyAffectedPlayers(action);

        return ActionResult.Success;
    }

    // 이벤트가 없으면 이 코드는 실행되지 않음
    // → CPU 유휴 상태
}
```

---

## 하이브리드 접근법

### 실제 게임 서버 아키텍처

```
┌─────────────────────────────────────────────────────────────────┐
│                   하이브리드 아키텍처                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    입력 레이어                           │   │
│  │              (이벤트 기반 / Actor)                       │   │
│  │                                                         │   │
│  │  PlayerActor ──▶ 입력 검증 ──▶ 명령 큐잉               │   │
│  └─────────────────────────┬───────────────────────────────┘   │
│                            │                                    │
│                            ▼                                    │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                   게임 로직 레이어                       │   │
│  │              (Tick 기반 / Game Loop)                     │   │
│  │                                                         │   │
│  │  매 Tick:                                               │   │
│  │  1. 큐에서 입력 꺼내기                                  │   │
│  │  2. 물리 업데이트                                       │   │
│  │  3. 충돌 처리                                           │   │
│  │  4. 게임 규칙 적용                                      │   │
│  └─────────────────────────┬───────────────────────────────┘   │
│                            │                                    │
│                            ▼                                    │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                   출력 레이어                           │   │
│  │              (이벤트 기반 / Actor)                       │   │
│  │                                                         │   │
│  │  StateSync ──▶ 델타 계산 ──▶ 플레이어에게 전송          │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 구현 예시

```csharp
// 하이브리드 게임 서버
public class HybridGameServer
{
    private readonly ConcurrentQueue<PlayerInput> _inputQueue;
    private readonly IActorSystem _actorSystem;
    private GameState _gameState;

    // Tick 기반 게임 루프
    public async Task RunGameLoop(CancellationToken ct)
    {
        var tickRate = TimeSpan.FromMilliseconds(16); // 60fps
        var timer = new PeriodicTimer(tickRate);

        while (await timer.WaitForNextTickAsync(ct))
        {
            // 1. 큐에서 모든 입력 수집
            var inputs = CollectInputs();

            // 2. 물리 및 게임 로직 업데이트 (동기)
            _gameState = GameLogic.Update(_gameState, inputs, tickRate);

            // 3. 상태 변경 브로드캐스트 (비동기/Actor)
            await BroadcastStateChanges();
        }
    }

    private List<PlayerInput> CollectInputs()
    {
        var inputs = new List<PlayerInput>();
        while (_inputQueue.TryDequeue(out var input))
        {
            inputs.Add(input);
        }
        return inputs;
    }

    private async Task BroadcastStateChanges()
    {
        var delta = _gameState.GetDeltaSinceLastBroadcast();
        if (delta.HasChanges)
        {
            // Actor를 통해 각 플레이어에게 전송
            foreach (var playerId in _gameState.ActivePlayers)
            {
                var playerActor = _actorSystem.GetActor<IPlayerActor>(playerId);
                // Fire and forget (비동기)
                _ = playerActor.SendStateUpdate(delta.ForPlayer(playerId));
            }
        }
    }
}

// 플레이어 Actor (이벤트 기반)
public class PlayerActor : IPlayerActor
{
    private readonly IGameServer _gameServer;
    private IClientConnection _connection;

    // 클라이언트 입력 수신 (이벤트 기반)
    public Task OnInput(PlayerInput input)
    {
        // 검증
        if (!ValidateInput(input))
            return Task.CompletedTask;

        // 게임 서버의 입력 큐에 추가
        _gameServer.QueueInput(input);

        return Task.CompletedTask;
    }

    // 상태 업데이트 전송 (이벤트 기반)
    public async Task SendStateUpdate(StateDelta delta)
    {
        if (_connection != null && _connection.IsConnected)
        {
            await _connection.SendAsync(delta);
        }
    }
}
```

---

## 장르별 권장 접근법

```
┌─────────────────────────────────────────────────────────────────┐
│                   장르별 권장 접근법                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  장르              게임 로직         상태 관리       네트워크    │
│  ─────────────────────────────────────────────────────────────  │
│  FPS/TPS          Tick (128Hz)      Tick           Tick (20Hz) │
│  격투 게임        Tick (60Hz)       Tick           Tick (60Hz) │
│  MOBA             Tick (30Hz)       하이브리드      Tick (20Hz) │
│  MMO RPG          하이브리드        Event          Event        │
│  턴제 전략        Event             Event          Event        │
│  카드 게임        Event             Event          Event        │
│  소셜/캐주얼      Event             Event          Event        │
│                                                                 │
│  ─────────────────────────────────────────────────────────────  │
│                                                                 │
│  Tick Rate 가이드:                                              │
│  ─────────────────                                              │
│  • 128Hz: 경쟁 FPS (CS2, Valorant 서버)                         │
│  • 60Hz: 격투 게임, 일부 FPS                                    │
│  • 30Hz: MOBA, 일반 액션                                        │
│  • 20Hz: MMO, 네트워크 상태 전송                                │
│  • 이벤트: 턴제, 비실시간                                       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Tick 기반에서 Actor 활용

### Zone Actor + Tick Loop

```cpp
// Zone을 Actor로, 내부는 Tick 기반
class ZoneActor {
    game_state state;
    std::vector<pending_input> input_queue;
    std::chrono::steady_clock::time_point last_tick;

    behavior make_behavior() {
        return {
            // 플레이어 입력 (이벤트)
            [this](player_input input) {
                input_queue.push_back(input);
            },

            // Tick 트리거 (타이머에서 호출)
            [this](tick_atom) {
                auto now = std::chrono::steady_clock::now();
                float dt = get_delta(last_tick, now);

                // Tick 기반 업데이트
                process_inputs();
                update_physics(dt);
                update_ai(dt);
                check_collisions();

                // 상태 변경 브로드캐스트
                broadcast_state();

                last_tick = now;

                // 다음 Tick 예약
                delayed_send(self, tick_duration, tick_atom_v);
            },

            // 플레이어 입장/퇴장 (이벤트)
            [this](player_enter, actor player) {
                players.insert(player);
            },
            [this](player_leave, actor player) {
                players.erase(player);
            }
        };
    }
};
```

### 선택적 Tick Rate

```csharp
// 상황에 따른 동적 Tick Rate
public class AdaptiveTickGameRoom
{
    private TimeSpan _currentTickRate;
    private const int HighActivityThreshold = 10;

    private TimeSpan CalculateOptimalTickRate()
    {
        var activityLevel = _pendingInputs.Count + _activeEffects.Count;

        if (activityLevel > HighActivityThreshold)
        {
            // 활발한 활동: 빠른 Tick
            return TimeSpan.FromMilliseconds(16);  // 60fps
        }
        else if (activityLevel > 0)
        {
            // 보통 활동: 중간 Tick
            return TimeSpan.FromMilliseconds(33);  // 30fps
        }
        else
        {
            // 유휴 상태: 느린 Tick 또는 이벤트 대기
            return TimeSpan.FromMilliseconds(100); // 10fps
        }
    }

    private async Task GameLoop()
    {
        while (_isRunning)
        {
            _currentTickRate = CalculateOptimalTickRate();

            ProcessTick();

            await Task.Delay(_currentTickRate);
        }
    }
}
```

---

## 이벤트 기반에서 시간 처리

### 타이머를 통한 주기적 처리

```csharp
// Orleans에서 타이머 활용
public class EventBasedGameGrain : Grain
{
    private IDisposable _stateTimer;
    private IDisposable _aiTimer;

    public override Task OnActivateAsync(CancellationToken token)
    {
        // 상태 브로드캐스트: 50ms마다 (20Hz)
        _stateTimer = RegisterTimer(
            BroadcastState,
            null,
            TimeSpan.FromMilliseconds(50),
            TimeSpan.FromMilliseconds(50)
        );

        // AI 업데이트: 200ms마다 (5Hz)
        _aiTimer = RegisterTimer(
            UpdateAI,
            null,
            TimeSpan.FromMilliseconds(200),
            TimeSpan.FromMilliseconds(200)
        );

        return base.OnActivateAsync(token);
    }

    // 플레이어 액션은 즉시 처리 (이벤트 기반)
    public Task ProcessAction(PlayerAction action)
    {
        ApplyAction(action);
        return Task.CompletedTask;
    }

    // 주기적 브로드캐스트 (타이머 기반)
    private Task BroadcastState(object _)
    {
        var snapshot = CreateStateSnapshot();
        foreach (var player in _players)
        {
            player.SendState(snapshot);
        }
        return Task.CompletedTask;
    }
}
```

### 논리적 시간 (Logical Time)

```csharp
// 이벤트 기반에서 결정적 실행을 위한 논리적 시간
public class LogicalTimeGameState
{
    public long LogicalTick { get; private set; }
    private readonly SortedList<long, List<GameEvent>> _scheduledEvents;

    public void ScheduleEvent(GameEvent evt, long atTick)
    {
        if (!_scheduledEvents.ContainsKey(atTick))
            _scheduledEvents[atTick] = new List<GameEvent>();

        _scheduledEvents[atTick].Add(evt);
    }

    public void AdvanceToTick(long targetTick)
    {
        while (LogicalTick < targetTick)
        {
            LogicalTick++;

            if (_scheduledEvents.TryGetValue(LogicalTick, out var events))
            {
                foreach (var evt in events)
                {
                    ProcessEvent(evt);
                }
                _scheduledEvents.Remove(LogicalTick);
            }
        }
    }

    // 이벤트 수신 시
    public void OnPlayerAction(PlayerAction action, long clientTick)
    {
        // 서버 시간으로 변환
        var serverTick = Math.Max(LogicalTick, clientTick);

        ScheduleEvent(new ActionEvent(action), serverTick);
    }
}
```

---

## 성능 비교

```
┌─────────────────────────────────────────────────────────────────┐
│                    성능 특성 비교                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│                    Tick 기반           이벤트 기반              │
│  ─────────────────────────────────────────────────────────────  │
│  CPU 사용량        일정 (유휴 시에도)   가변 (필요 시에만)       │
│  레이턴시          Tick 간격 의존      즉시 처리 가능           │
│  처리량            예측 가능           부하에 따라 변동          │
│  메모리            낮음               Actor당 오버헤드          │
│  확장성            제한적             높음                      │
│                                                                 │
│  ─────────────────────────────────────────────────────────────  │
│                                                                 │
│  시나리오별 권장:                                                │
│  ────────────────                                               │
│  • 물리 시뮬레이션 → Tick 기반                                  │
│  • 상태 동기화 → Tick 기반 (고정 간격)                          │
│  • 플레이어 입력 처리 → 이벤트 기반 (즉시)                      │
│  • 매치메이킹 → 이벤트 기반                                     │
│  • 채팅 → 이벤트 기반                                           │
│  • 거래 → 이벤트 기반                                           │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 결론: 선택 가이드

```
┌─────────────────────────────────────────────────────────────────┐
│                    선택 가이드                                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Tick 기반 선택:                                                 │
│  ───────────────                                                │
│  □ 물리 기반 게임플레이가 핵심인가?                              │
│  □ 결정적(Deterministic) 실행이 필요한가?                        │
│  □ 모든 클라이언트가 동일한 시뮬레이션을 봐야 하는가?            │
│  □ 레이턴시 < 20ms가 필수인가?                                   │
│                                                                 │
│  이벤트 기반 선택:                                               │
│  ─────────────────                                              │
│  □ 수평 확장이 중요한가?                                         │
│  □ 이벤트 발생 빈도가 낮은가?                                    │
│  □ 리소스 효율이 중요한가?                                       │
│  □ 서비스 지향 아키텍처를 원하는가?                              │
│                                                                 │
│  대부분의 경우: 하이브리드                                       │
│  ────────────────────────                                       │
│  • 실시간 게임 로직: Tick 기반                                  │
│  • 세션/상태 관리: Event 기반 (Actor)                           │
│  • 네트워크 I/O: Event 기반                                     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 다음 단계

- [mmo-architecture.md](./mmo-architecture.md) - MMO 아키텍처 상세
- [physics-simulation.md](./physics-simulation.md) - 물리 시뮬레이션과 Actor
- [fps-rts-patterns.md](./fps-rts-patterns.md) - FPS/RTS 장르별 패턴
