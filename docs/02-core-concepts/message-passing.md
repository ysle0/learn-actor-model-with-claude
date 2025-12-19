# 메시지 패싱 (Message Passing)

> Actor 간 통신의 핵심인 메시지 패싱의 원리와 패턴을 알아봅니다.

## 메시지 패싱이란?

Actor 간의 유일한 통신 수단입니다. 직접적인 메서드 호출이나 상태 공유 없이, **오직 메시지를 통해서만** 상호작용합니다.

```
┌─────────────────────────────────────────────────────────────┐
│                    메시지 패싱의 흐름                        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────┐                           ┌─────────┐         │
│  │ Actor A │                           │ Actor B │         │
│  │         │    ① 메시지 생성           │         │         │
│  │         │    ② 전송 (비동기)         │         │         │
│  │         │ ─────────────────────────▶│ Mailbox │         │
│  │         │                           │  [msg]  │         │
│  │         │                           │         │         │
│  │         │                           │ ③ 처리   │         │
│  │         │                           │         │         │
│  └─────────┘                           └─────────┘         │
│                                                             │
│  핵심: 전송 즉시 리턴, 응답 대기하지 않음                     │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 메시지의 특성

### 1. 불변성 (Immutability)

메시지는 반드시 **불변(Immutable)**이어야 합니다:

```cpp
// ❌ 잘못된 예: 가변 메시지
struct BadMessage {
    std::vector<int>& data;  // 참조! 위험!
};

// ✅ 올바른 예: 불변 메시지
struct GoodMessage {
    const std::vector<int> data;  // 복사본, 안전
};
```

**이유:**
- 메시지가 전송 후 변경되면 예측 불가능한 동작
- 여러 Actor가 같은 메시지를 받을 수 있음
- 디버깅 어려움 방지

### 2. 비동기성 (Asynchrony)

```go
// Go: 전송 후 즉시 리턴
pid.Tell(&MoveCommand{X: 10, Y: 20})
// 여기서 이미 다음 코드 실행 중

// Actor B는 나중에 처리
func (a *GameActor) Receive(ctx actor.Context) {
    switch msg := ctx.Message().(type) {
    case *MoveCommand:
        // 이 시점에 처리됨
    }
}
```

### 3. 순서 보장 (Ordering)

**같은 Actor 쌍 사이**에서는 순서 보장:

```
Actor A → Actor B

A가 보낸 순서:  M1, M2, M3
B가 받는 순서:  M1, M2, M3  ✅ 순서 보장
```

**다른 Actor에서 오는 메시지**는 순서 미보장:

```
Actor A → Actor C:  M1, M2
Actor B → Actor C:  M3, M4

C가 받는 순서:  M1, M3, M2, M4  (가능)
               M3, M1, M4, M2  (가능)
               ...
```

---

## 메시지 패턴

### 1. Tell (Fire-and-Forget)

가장 기본적인 패턴. 응답을 기다리지 않습니다.

```scala
// Akka
actor ! Message("hello")  // 보내고 바로 리턴
```

```csharp
// Orleans
await grain.ProcessAsync(data);  // 실행만, 결과 없음
```

```go
// Proto.Actor
pid.Tell(&MyMessage{})
```

**사용 사례:**
- 로깅
- 이벤트 발행
- 상태 업데이트 알림
- 단방향 명령

### 2. Ask (Request-Response)

응답을 기다립니다. Future/Promise 반환.

```scala
// Akka
implicit val timeout: Timeout = 5.seconds
val future: Future[String] = (actor ? GetStatus).mapTo[String]
val result = Await.result(future, timeout.duration)
```

```csharp
// Orleans
var result = await grain.GetDataAsync();  // 결과 대기
```

```go
// Proto.Actor
future := ctx.RequestFuture(pid, &GetData{}, 5*time.Second)
result, err := future.Result()
```

**주의사항:**
- 타임아웃 설정 필수
- 데드락 위험 (상호 Ask 금지)
- 성능 오버헤드

### 3. Forward

원래의 sender를 유지하면서 다른 Actor에게 전달:

```scala
// Akka
def receive = {
  case msg =>
    anotherActor.forward(msg)  // sender() 유지
}
```

```
Client → Router → Worker
           │
           └── forward (Client이 sender로 유지)
                   │
                   ▼
        Worker가 Client에게 직접 응답 가능
```

### 4. Pipe

비동기 결과를 다른 Actor에게 전달:

```scala
// Akka
import akka.pattern.pipe

val future: Future[Result] = externalService.call()
future.pipeTo(resultHandler)  // 완료 시 resultHandler에 전달
```

---

## 메시지 라우팅

### Round Robin

```scala
val router = system.actorOf(
  RoundRobinPool(5).props(Props[Worker]),
  "router"
)
// M1→W1, M2→W2, M3→W3, M4→W4, M5→W5, M6→W1, ...
```

### Random

```scala
val router = system.actorOf(
  RandomPool(5).props(Props[Worker]),
  "router"
)
// 무작위 분배
```

### Broadcast

```scala
val router = system.actorOf(
  BroadcastPool(5).props(Props[Worker]),
  "router"
)
// 모든 Worker에게 전달
```

### Consistent Hashing

```scala
val router = system.actorOf(
  ConsistentHashingPool(5).props(Props[Worker]),
  "router"
)
// 메시지의 해시값에 따라 동일 Worker로
```

---

## 메시지 타입 설계

### 1. 명령 (Command)

Actor에게 무언가를 하라고 지시:

```typescript
interface CreatePlayer {
  type: 'CREATE_PLAYER';
  playerId: string;
  name: string;
}

interface MovePlayer {
  type: 'MOVE_PLAYER';
  playerId: string;
  x: number;
  y: number;
}
```

### 2. 이벤트 (Event)

이미 발생한 일을 알림:

```typescript
interface PlayerCreated {
  type: 'PLAYER_CREATED';
  playerId: string;
  timestamp: Date;
}

interface PlayerMoved {
  type: 'PLAYER_MOVED';
  playerId: string;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
}
```

### 3. 쿼리 (Query)

정보 요청:

```typescript
interface GetPlayerInfo {
  type: 'GET_PLAYER_INFO';
  playerId: string;
}

interface PlayerInfo {
  playerId: string;
  name: string;
  health: number;
  position: { x: number; y: number };
}
```

---

## 메시지 신뢰성

### At-Most-Once (기본)

```
┌─────────────────────────────────────────┐
│ At-Most-Once Delivery                   │
├─────────────────────────────────────────┤
│ • 메시지가 0번 또는 1번 전달됨            │
│ • 유실 가능, 중복 없음                   │
│ • 가장 빠름                             │
│ • 로깅, 메트릭 등에 적합                 │
└─────────────────────────────────────────┘
```

### At-Least-Once

```
┌─────────────────────────────────────────┐
│ At-Least-Once Delivery                  │
├─────────────────────────────────────────┤
│ • 메시지가 1번 이상 전달됨               │
│ • 유실 없음, 중복 가능                   │
│ • 재전송 로직 필요                       │
│ • 결제, 주문 등에 적합                   │
└─────────────────────────────────────────┘
```

```scala
// Akka Persistence
class ReliableActor extends PersistentActor {
  def receiveCommand = {
    case cmd =>
      persist(cmd) { evt =>
        // 영속화 후 처리
      }
  }
}
```

### Exactly-Once

```
┌─────────────────────────────────────────┐
│ Exactly-Once Delivery                   │
├─────────────────────────────────────────┤
│ • 메시지가 정확히 1번 전달됨             │
│ • 유실 없음, 중복 없음                   │
│ • 구현 복잡, 성능 저하                   │
│ • 멱등성(Idempotency) 필요              │
└─────────────────────────────────────────┘
```

---

## 성능 고려사항

### 메시지 크기

```cpp
// ❌ 큰 메시지
struct HugeMessage {
    std::vector<char> data;  // 10MB
};

// ✅ 참조 전달 (같은 프로세스 내)
struct SmartMessage {
    std::shared_ptr<const LargeData> data;
};
```

### 메시지 빈도

```
높은 빈도 (60 msgs/sec)    →   배치 처리 고려
  │
  ▼
┌─────┬─────┬─────┬─────┐     ┌─────────────────┐
│ M1  │ M2  │ M3  │ M4  │ ──▶ │ [M1, M2, M3, M4]│
└─────┴─────┴─────┴─────┘     └─────────────────┘
  개별 전송                      배치 전송
```

### 백프레셔 (Backpressure)

```scala
// Akka Streams
Source(1 to 1000000)
  .map(transform)
  .runWith(Sink.actorRef(targetActor, Complete))
  // 자동으로 백프레셔 적용
```

---

## 다음 단계

- [Mailbox](./mailbox.md) - Mailbox 구현과 정책
- [State & Behavior](./state-behavior.md) - Become/Unbecome 패턴
