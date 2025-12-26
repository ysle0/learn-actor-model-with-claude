# 레이턴시 고려사항

> 실시간 게임에서의 Actor Model 레이턴시 분석

## 레이턴시 구성 요소

```
┌─────────────────────────────────────────────────────────────────┐
│                   End-to-End Latency                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   Client → Server → Process → Broadcast → Client                │
│                                                                  │
│   ┌──────┐  ┌──────┐  ┌──────┐  ┌──────┐  ┌──────┐            │
│   │ Net  │ +│Queue │ +│ Actor│ +│ Net  │ =│Total │            │
│   │ 20ms │  │ 1ms  │  │ 0.5ms│  │ 20ms │  │~42ms │            │
│   └──────┘  └──────┘  └──────┘  └──────┘  └──────┘            │
│                                                                  │
│   네트워크        메일박스    메시지 처리   브로드캐스트         │
│   (RTT/2)         대기        시간          네트워크             │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Actor Model 레이턴시 특성

### 메일박스 대기 시간

```
Actor가 바쁠 때:

Mailbox: [msg1][msg2][msg3][msg4][new msg]
                                     ↑
                              대기 시간 증가

해결책:
• 메시지 우선순위 큐
• Actor 분할 (샤딩)
• 처리 시간 최소화
```

### Ask vs Tell 레이턴시

```
┌─────────────────────────────────────────────────────────────────┐
│                 Ask vs Tell Latency                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   Tell (Fire-and-Forget):                                        │
│   Client ──msg──▶ Actor                                         │
│   지연: ~0ms (메시지 큐잉만)                                     │
│                                                                  │
│   Ask (Request-Response):                                        │
│   Client ──req──▶ Actor ──resp──▶ Client                        │
│   지연: 처리시간 + 응답 네트워크                                 │
│                                                                  │
│   권장:                                                          │
│   • 실시간 액션: Tell 사용                                      │
│   • 결과 필요 시: Ask 사용, 타임아웃 설정                       │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## 장르별 레이턴시 요구사항

```
┌─────────────────────────────────────────────────────────────────┐
│             Latency Requirements by Genre                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   게임 장르          허용 레이턴시      Actor 적합도             │
│   ─────────          ────────────      ───────────             │
│   FPS                < 50ms            ⚠️ 주의 필요             │
│   격투 게임          < 30ms            ❌ 부적합                │
│   RTS                < 100ms           ✅ 적합                  │
│   MMORPG             < 200ms           ✅ 매우 적합             │
│   턴제 게임          < 1000ms          ✅ 완벽                  │
│   퍼즐 게임          < 500ms           ✅ 완벽                  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## 레이턴시 최적화 기법

### 1. 메시지 배치 처리

```csharp
public class OptimizedZoneActor : Grain
{
    private readonly List<PlayerAction> _pendingActions = new();
    private IDisposable? _batchTimer;

    public override Task OnActivateAsync(CancellationToken ct)
    {
        // 20ms마다 배치 처리 (50 FPS)
        _batchTimer = RegisterTimer(ProcessBatch, null,
            TimeSpan.FromMilliseconds(20),
            TimeSpan.FromMilliseconds(20));
        return base.OnActivateAsync(ct);
    }

    public Task QueueAction(PlayerAction action)
    {
        _pendingActions.Add(action);
        return Task.CompletedTask; // 즉시 반환
    }

    private async Task ProcessBatch(object state)
    {
        if (_pendingActions.Count == 0) return;

        var actions = _pendingActions.ToList();
        _pendingActions.Clear();

        // 한 번에 처리
        foreach (var action in actions)
        {
            await ProcessAction(action);
        }

        // 한 번에 브로드캐스트
        await BroadcastState();
    }
}
```

### 2. 로컬 예측 (Client-Side Prediction)

```
┌─────────────────────────────────────────────────────────────────┐
│                 Client-Side Prediction                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   1. 클라이언트가 즉시 액션 적용 (예측)                         │
│   2. 서버에 액션 전송                                           │
│   3. 서버 응답 수신                                             │
│   4. 예측과 다르면 보정 (Reconciliation)                        │
│                                                                  │
│   Client:  [이동] ──────────▶ [확인] ──▶ [보정]                │
│              ↓                   ↑                               │
│           즉시 적용            서버 응답                         │
│                                                                  │
│   효과: 체감 레이턴시 ~0ms                                      │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 3. 관심 영역 (AOI) 최적화

```csharp
public class SpatialZoneActor : Grain
{
    private readonly SpatialGrid _grid;

    public async Task BroadcastMovement(string playerId, Position newPos)
    {
        // 관심 영역 내 플레이어만
        var nearbyPlayers = _grid.GetNearby(newPos, viewDistance: 100);

        // 병렬 전송
        await Task.WhenAll(
            nearbyPlayers
                .Where(p => p.Id != playerId)
                .Select(p => p.Actor.NotifyMovement(playerId, newPos))
        );
    }
}
```

### 4. 우선순위 메일박스

```scala
// Akka 우선순위 메일박스
class GameMessageMailbox extends UnboundedStablePriorityMailbox(
  PriorityGenerator {
    case PlayerInput(_) => 0      // 최고 우선순위
    case CombatAction(_) => 1     // 높은 우선순위
    case ChatMessage(_) => 5      // 낮은 우선순위
    case _ => 3                   // 기본
  }
)
```

## 측정 및 모니터링

```csharp
public class LatencyMonitor
{
    private readonly ConcurrentDictionary<string, Stopwatch> _pending = new();

    public void StartTracking(string requestId)
    {
        _pending[requestId] = Stopwatch.StartNew();
    }

    public void EndTracking(string requestId)
    {
        if (_pending.TryRemove(requestId, out var sw))
        {
            var latency = sw.ElapsedMilliseconds;
            Metrics.RecordLatency("game.request.latency", latency);

            if (latency > 100)
            {
                Logger.Warning("High latency: {Latency}ms for {RequestId}",
                    latency, requestId);
            }
        }
    }
}
```

## 권장 아키텍처

```
실시간 액션 게임:
┌───────────────────────────────────────────────────────┐
│  전용 물리/게임 루프 스레드                          │
│       ↓                                               │
│  Actor System (상태 관리, 영속화)                    │
│       ↓                                               │
│  네트워크 레이어 (UDP 선호)                          │
└───────────────────────────────────────────────────────┘

MMO/전략 게임:
┌───────────────────────────────────────────────────────┐
│  Actor System (모든 게임 로직)                       │
│       ↓                                               │
│  Zone Sharding                                        │
│       ↓                                               │
│  TCP/WebSocket                                        │
└───────────────────────────────────────────────────────┘
```

## 관련 문서

- [Tick 기반 vs 이벤트 기반](./tick-based-vs-event.md)
- [게임 서버 아키텍처](../06-game-server/architecture-patterns.md)
- [성능 비교](../03-actor-vs-threads/performance-comparison.md)
