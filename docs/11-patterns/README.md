# 11. Actor 디자인 패턴

> Actor Model에서 자주 사용되는 디자인 패턴과 안티패턴

## 개요

Actor Model을 효과적으로 활용하기 위한 검증된 디자인 패턴들을 소개합니다. 각 패턴은 특정 문제를 해결하기 위한 재사용 가능한 솔루션입니다.

## 메시지 패턴

### 1. Request-Reply (Ask) 패턴

```
┌─────────────────────────────────────────────────────────────────┐
│                    Request-Reply Pattern                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   ┌─────────┐    Request     ┌─────────┐                        │
│   │ Sender  │ ─────────────▶ │ Target  │                        │
│   │  Actor  │                │  Actor  │                        │
│   └────┬────┘                └────┬────┘                        │
│        │                          │                              │
│        │◀───────────────────────┘                              │
│        │        Reply                                            │
│        ▼                                                         │
│   [Future/Promise]                                               │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**사용 사례:**
- 쿼리 결과 요청
- 상태 확인
- 동기적 응답이 필요한 경우

**Akka 예시 (Scala):**
```scala
import akka.actor.typed.scaladsl.AskPattern._
import akka.util.Timeout
import scala.concurrent.duration._

implicit val timeout: Timeout = 3.seconds

val future: Future[Response] = actor.ask(ref => Request(data, ref))
```

**주의사항:**
- 타임아웃 설정 필수
- 데드락 주의 (Actor가 자신에게 ask하면 안됨)
- 가능하면 Tell 패턴 선호

**상세 문서:** [Request-Reply 패턴](./request-reply.md)

---

### 2. Fire-and-Forget (Tell) 패턴

```
┌─────────────────────────────────────────────────────────────────┐
│                   Fire-and-Forget Pattern                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   ┌─────────┐     Message     ┌─────────┐                       │
│   │ Sender  │ ──────────────▶ │ Target  │                       │
│   │  Actor  │                 │  Actor  │                       │
│   └─────────┘                 └─────────┘                       │
│       │                                                          │
│       ▼                                                          │
│   (즉시 계속 진행)                                               │
│                                                                  │
│   특징:                                                          │
│   • 응답 대기 없음                                               │
│   • 최대 처리량                                                  │
│   • 느슨한 결합                                                  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**사용 사례:**
- 로깅, 메트릭 수집
- 이벤트 발행
- 상태 업데이트

---

### 3. Scatter-Gather 패턴

```
┌─────────────────────────────────────────────────────────────────┐
│                    Scatter-Gather Pattern                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│              Scatter (분산)                                      │
│                  │                                               │
│        ┌─────────┼─────────┐                                    │
│        │         │         │                                    │
│        ▼         ▼         ▼                                    │
│   ┌────────┐ ┌────────┐ ┌────────┐                             │
│   │Worker 1│ │Worker 2│ │Worker 3│                             │
│   └───┬────┘ └───┬────┘ └───┬────┘                             │
│       │          │          │                                    │
│       └──────────┼──────────┘                                   │
│                  │                                               │
│                  ▼                                               │
│            Gather (수집)                                         │
│         ┌────────────────┐                                      │
│         │   Aggregator   │                                      │
│         └────────────────┘                                      │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**구현 (TypeScript):**
```typescript
class ScatterGatherActor extends Actor<ScatterGatherMessage> {
  private responses: Map<string, Result> = new Map();
  private expectedCount: number = 0;
  private replyTo: ActorRef | null = null;

  protected receive(message: ScatterGatherMessage): void {
    switch (message.type) {
      case 'SCATTER':
        this.scatter(message.workers, message.query, message.replyTo);
        break;
      case 'WORKER_RESULT':
        this.gatherResult(message.workerId, message.result);
        break;
    }
  }

  private scatter(workers: ActorRef[], query: Query, replyTo: ActorRef): void {
    this.expectedCount = workers.length;
    this.replyTo = replyTo;
    this.responses.clear();

    workers.forEach((worker, idx) => {
      worker.send({
        type: 'QUERY',
        query,
        replyTo: this.self
      });
    });

    // 타임아웃 설정
    setTimeout(() => this.checkComplete(), 5000);
  }

  private gatherResult(workerId: string, result: Result): void {
    this.responses.set(workerId, result);
    this.checkComplete();
  }

  private checkComplete(): void {
    if (this.responses.size >= this.expectedCount && this.replyTo) {
      const aggregated = this.aggregate(Array.from(this.responses.values()));
      this.replyTo.send({ type: 'AGGREGATED_RESULT', result: aggregated });
    }
  }
}
```

**사용 사례:**
- 분산 검색
- 여러 서비스에서 데이터 수집
- 병렬 처리 후 결과 집계

**상세 문서:** [Scatter-Gather 패턴](./scatter-gather.md)

---

### 4. Pipe and Filter 패턴

```
┌─────────────────────────────────────────────────────────────────┐
│                   Pipe and Filter Pattern                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   Input ──▶ [Filter 1] ──▶ [Filter 2] ──▶ [Filter 3] ──▶ Output │
│                                                                  │
│   ┌────────┐   ┌────────┐   ┌────────┐   ┌────────┐            │
│   │ Parser │──▶│Validate│──▶│Transform│──▶│ Store  │            │
│   └────────┘   └────────┘   └────────┘   └────────┘            │
│                                                                  │
│   각 단계가 독립적인 Actor                                       │
│   단계 간 메시지로 연결                                          │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**상세 문서:** [Pipeline 패턴](./pipeline.md)

---

## 상태 관리 패턴

### 5. FSM (Finite State Machine) 패턴

```
┌─────────────────────────────────────────────────────────────────┐
│              Finite State Machine Pattern                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│                    ┌─────────┐                                  │
│                    │  Idle   │                                  │
│                    └────┬────┘                                  │
│                         │ start                                  │
│                         ▼                                        │
│   ┌─────────┐     ┌─────────┐     ┌─────────┐                  │
│   │ Error   │◀────│ Running │────▶│Complete │                  │
│   └─────────┘     └────┬────┘     └─────────┘                  │
│        │               │ pause                                   │
│        │               ▼                                         │
│        │          ┌─────────┐                                   │
│        └─────────▶│ Paused  │                                   │
│                   └─────────┘                                   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**Akka 구현:**
```scala
sealed trait State
case object Idle extends State
case object Running extends State
case object Paused extends State

sealed trait Data
case object Empty extends Data
case class JobData(job: Job) extends Data

class JobProcessor extends FSM[State, Data] {
  startWith(Idle, Empty)

  when(Idle) {
    case Event(StartJob(job), Empty) =>
      goto(Running) using JobData(job)
  }

  when(Running) {
    case Event(Pause, data: JobData) =>
      goto(Paused) using data
    case Event(Complete, _) =>
      goto(Idle) using Empty
  }

  when(Paused) {
    case Event(Resume, data: JobData) =>
      goto(Running) using data
  }

  onTransition {
    case Idle -> Running =>
      log.info("Job started")
    case Running -> Paused =>
      log.info("Job paused")
  }

  initialize()
}
```

**상세 문서:** [FSM 패턴](./fsm.md)

---

### 6. Become/Unbecome 패턴

```
┌─────────────────────────────────────────────────────────────────┐
│                  Become/Unbecome Pattern                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   Actor의 동적 행동 변경                                         │
│                                                                  │
│   ┌─────────────────────────────────────────────────────┐       │
│   │                     Actor                            │       │
│   │                                                      │       │
│   │   현재 행동: normalBehavior                         │       │
│   │              │                                       │       │
│   │              │ become(busyBehavior)                 │       │
│   │              ▼                                       │       │
│   │   현재 행동: busyBehavior                           │       │
│   │              │                                       │       │
│   │              │ unbecome()                           │       │
│   │              ▼                                       │       │
│   │   현재 행동: normalBehavior                         │       │
│   │                                                      │       │
│   └─────────────────────────────────────────────────────┘       │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**Akka 예시:**
```scala
class SwitchableActor extends Actor {
  import context._

  def receive = normal

  def normal: Receive = {
    case "switch" =>
      become(alternative)
    case msg =>
      println(s"Normal: $msg")
  }

  def alternative: Receive = {
    case "switch" =>
      unbecome()
    case msg =>
      println(s"Alternative: $msg")
  }
}
```

**상세 문서:** [Become 패턴](./become.md)

---

### 7. Stash 패턴

```
┌─────────────────────────────────────────────────────────────────┐
│                        Stash Pattern                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   바쁜 상태에서 메시지 임시 저장                                 │
│                                                                  │
│   ┌─────────────────────────────────────────────────────┐       │
│   │                      Actor                           │       │
│   │                                                      │       │
│   │   Mailbox:  [M1] [M2] [M3]                          │       │
│   │                                                      │       │
│   │   상태: Initializing (바쁨)                         │       │
│   │         → M2, M3 stash                              │       │
│   │                                                      │       │
│   │   Stash:    [M2] [M3]                               │       │
│   │                                                      │       │
│   │   초기화 완료 → unstashAll()                        │       │
│   │                                                      │       │
│   │   Mailbox:  [M2] [M3] [새 메시지...]                │       │
│   │                                                      │       │
│   └─────────────────────────────────────────────────────┘       │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**Akka 구현:**
```scala
class DatabaseActor extends Actor with Stash {
  def receive = uninitialized

  def uninitialized: Receive = {
    case Initialize(config) =>
      // 데이터베이스 연결
      connectToDatabase(config).onComplete {
        case Success(conn) =>
          self ! ConnectionReady(conn)
        case Failure(ex) =>
          self ! ConnectionFailed(ex)
      }

    case ConnectionReady(conn) =>
      unstashAll()  // stash된 메시지 모두 처리
      context.become(ready(conn))

    case _ =>
      stash()  // 초기화 전 메시지는 stash
  }

  def ready(conn: Connection): Receive = {
    case Query(sql) =>
      sender() ! conn.execute(sql)
  }
}
```

**상세 문서:** [Stash 패턴](./stash.md)

---

## 분산 패턴

### 8. Event Sourcing

```
┌─────────────────────────────────────────────────────────────────┐
│                    Event Sourcing Pattern                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   상태 = 이벤트의 합                                             │
│                                                                  │
│   Events:                                                        │
│   ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐                  │
│   │Created │→│Deposited→│Withdrawn│→│Deposited│ = 현재 상태    │
│   │$0      │ │$100    │ │$30     │ │$50     │                  │
│   └────────┘ └────────┘ └────────┘ └────────┘                  │
│                                                                  │
│   현재 잔액: $0 + $100 - $30 + $50 = $120                       │
│                                                                  │
│   장점:                                                          │
│   • 완전한 감사 이력                                             │
│   • 시간 여행 (과거 상태 복원)                                   │
│   • 이벤트 재생으로 버그 재현                                    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**Akka Persistence 예시:**
```scala
class BankAccount extends PersistentActor {
  override def persistenceId = s"account-${self.path.name}"

  var balance: BigDecimal = 0

  // 명령 처리
  def receiveCommand: Receive = {
    case Deposit(amount) if amount > 0 =>
      persist(Deposited(amount)) { event =>
        updateState(event)
        sender() ! balance
      }

    case Withdraw(amount) if amount <= balance =>
      persist(Withdrawn(amount)) { event =>
        updateState(event)
        sender() ! balance
      }
  }

  // 이벤트로 상태 복원
  def receiveRecover: Receive = {
    case event: AccountEvent => updateState(event)
  }

  def updateState(event: AccountEvent): Unit = event match {
    case Deposited(amount) => balance += amount
    case Withdrawn(amount) => balance -= amount
  }
}
```

**상세 문서:** [Event Sourcing 패턴](./event-sourcing.md)

---

### 9. CQRS (Command Query Responsibility Segregation)

```
┌─────────────────────────────────────────────────────────────────┐
│                        CQRS Pattern                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│                    ┌──────────────┐                             │
│                    │   Client     │                             │
│                    └──────┬───────┘                             │
│                           │                                      │
│              ┌────────────┴────────────┐                        │
│              │                         │                         │
│              ▼                         ▼                         │
│       ┌──────────┐              ┌──────────┐                    │
│       │ Command  │              │  Query   │                    │
│       │  Side    │              │  Side    │                    │
│       └────┬─────┘              └────┬─────┘                    │
│            │                         │                          │
│            ▼                         ▼                          │
│       ┌──────────┐              ┌──────────┐                    │
│       │  Write   │   Projection │  Read    │                    │
│       │  Model   │─────────────▶│  Model   │                    │
│       │ (Events) │              │ (Views)  │                    │
│       └──────────┘              └──────────┘                    │
│                                                                  │
│   Command: 상태 변경 (Write)                                     │
│   Query: 상태 조회 (Read)                                        │
│   각각 최적화된 모델 사용                                        │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**상세 문서:** [CQRS 패턴](./cqrs.md)

---

### 10. Saga 패턴

```
┌─────────────────────────────────────────────────────────────────┐
│                        Saga Pattern                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   분산 트랜잭션 관리                                             │
│                                                                  │
│   정상 흐름:                                                     │
│   ┌────────┐   ┌────────┐   ┌────────┐   ┌────────┐            │
│   │Order   │──▶│Payment │──▶│Inventory│──▶│Shipping│            │
│   │Create  │   │Process │   │Reserve │   │Arrange │            │
│   └────────┘   └────────┘   └────────┘   └────────┘            │
│                                                                  │
│   보상 흐름 (실패 시):                                           │
│   ┌────────┐   ┌────────┐   ┌────────┐                         │
│   │Order   │◀──│Payment │◀──│Inventory│   ✗ Shipping 실패       │
│   │Cancel  │   │Refund  │   │Release │                         │
│   └────────┘   └────────┘   └────────┘                         │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**Orchestration vs Choreography:**

```
Orchestration (중앙 조정):
   ┌─────────────┐
   │   Saga      │
   │ Coordinator │
   └──────┬──────┘
      ────┼────
     │    │    │
     ▼    ▼    ▼
   [S1] [S2] [S3]

Choreography (이벤트 기반):
   [S1] ──event──▶ [S2] ──event──▶ [S3]
         ◀────────      ◀────────
         compensate     compensate
```

**상세 문서:** [Saga 패턴](./saga.md)

---

## 라우팅 패턴

### 11. Router 패턴

```
┌─────────────────────────────────────────────────────────────────┐
│                       Router Patterns                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   Round Robin:                                                   │
│   ┌────────┐         ┌────────┐                                │
│   │ Router │ ──1──▶  │Worker 1│                                │
│   │        │ ──2──▶  │Worker 2│                                │
│   │        │ ──3──▶  │Worker 3│                                │
│   │        │ ──4──▶  │Worker 1│  (순환)                        │
│   └────────┘         └────────┘                                │
│                                                                  │
│   Random:                                                        │
│   ┌────────┐         ┌────────┐                                │
│   │ Router │ ──?──▶  │Worker ?│  (무작위)                      │
│   └────────┘         └────────┘                                │
│                                                                  │
│   Smallest Mailbox:                                              │
│   ┌────────┐         ┌────────┐                                │
│   │ Router │ ──────▶ │최소 큐 │  (가장 여유로운 Worker)        │
│   └────────┘         └────────┘                                │
│                                                                  │
│   Consistent Hashing:                                            │
│   ┌────────┐         ┌────────┐                                │
│   │ Router │ ─hash─▶ │동일 키 │  (같은 키 = 같은 Worker)       │
│   └────────┘         │= 같은  │                                │
│                      │ Worker │                                │
│                      └────────┘                                │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**Akka Router 예시:**
```scala
val router = system.actorOf(
  RoundRobinPool(5).props(Props[Worker]),
  "workerRouter"
)

// 또는 Consistent Hashing
val hashRouter = system.actorOf(
  ConsistentHashingPool(10).props(Props[CacheActor]),
  "cacheRouter"
)

hashRouter ! ConsistentHashableEnvelope(
  message = GetValue("key"),
  hashKey = "key"  // 같은 키는 항상 같은 actor로
)
```

**상세 문서:** [Router 패턴](./router.md)

---

## 복원력 패턴

### 12. Circuit Breaker 패턴

```
┌─────────────────────────────────────────────────────────────────┐
│                   Circuit Breaker Pattern                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   ┌─────────┐      ┌─────────┐      ┌─────────┐                │
│   │ CLOSED  │─────▶│  OPEN   │─────▶│HALF-OPEN│                │
│   │(정상)   │ 실패 │(차단)   │ 타임 │(시험)   │                │
│   └────┬────┘ 임계 └────┬────┘ 아웃 └────┬────┘                │
│        │       초과      │              │                       │
│        │◀───────────────┴──────────────┘                       │
│        │                  성공 시                                │
│                                                                  │
│   상태:                                                          │
│   • CLOSED: 정상 동작, 요청 통과                                 │
│   • OPEN: 실패 임계치 초과, 즉시 실패 반환                       │
│   • HALF-OPEN: 일부 요청 시험적 허용                            │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**Akka 구현:**
```scala
import akka.pattern.CircuitBreaker

val breaker = new CircuitBreaker(
  scheduler = system.scheduler,
  maxFailures = 5,
  callTimeout = 10.seconds,
  resetTimeout = 1.minute
)

def callExternalService(request: Request): Future[Response] = {
  breaker.withCircuitBreaker {
    externalService.call(request)
  } recover {
    case _: CircuitBreakerOpenException =>
      CachedResponse  // 폴백
  }
}
```

**상세 문서:** [Circuit Breaker 패턴](./circuit-breaker.md)

---

### 13. Dead Letter 패턴

```
┌─────────────────────────────────────────────────────────────────┐
│                    Dead Letter Pattern                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   배달 불가 메시지 처리                                          │
│                                                                  │
│   ┌─────────┐    Message    ┌─────────┐                        │
│   │ Sender  │ ─────────────▶│  Dead   │  (Actor 없음)          │
│   └─────────┘               │ Target  │                        │
│                             └────┬────┘                        │
│                                  │                              │
│                                  ▼                              │
│                          ┌────────────┐                        │
│                          │Dead Letter │                        │
│                          │  Mailbox   │                        │
│                          └─────┬──────┘                        │
│                                │                                │
│                                ▼                                │
│                          ┌────────────┐                        │
│                          │  Logging   │                        │
│                          │  Alerting  │                        │
│                          │  Retry     │                        │
│                          └────────────┘                        │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**Akka 예시:**
```scala
system.eventStream.subscribe(
  system.actorOf(Props[DeadLetterMonitor]),
  classOf[DeadLetter]
)

class DeadLetterMonitor extends Actor {
  def receive = {
    case DeadLetter(message, sender, recipient) =>
      log.warning(
        s"Dead letter: $message from $sender to $recipient"
      )
      // 알림 또는 재시도 로직
  }
}
```

**상세 문서:** [Dead Letter 패턴](./dead-letter.md)

---

## 안티패턴

### 피해야 할 패턴들

```
┌─────────────────────────────────────────────────────────────────┐
│                      Anti-Patterns                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   1. 가변 상태 공유 ❌                                           │
│   ────────────────────                                          │
│   // 나쁜 예                                                     │
│   var sharedState = mutableList                                 │
│   actor1 ! ProcessWith(sharedState)                             │
│   actor2 ! ProcessWith(sharedState)  // 동시 접근!              │
│                                                                  │
│   // 좋은 예                                                     │
│   actor1 ! ProcessWith(sharedState.toList)  // 불변 복사        │
│                                                                  │
│   ─────────────────────────────────────────────────────────────  │
│                                                                  │
│   2. sender() 클로저 캡처 ❌                                     │
│   ───────────────────────                                       │
│   // 나쁜 예                                                     │
│   Future {                                                       │
│     val result = longComputation()                              │
│     sender() ! result  // sender가 바뀌었을 수 있음!            │
│   }                                                              │
│                                                                  │
│   // 좋은 예                                                     │
│   val replyTo = sender()                                        │
│   Future {                                                       │
│     val result = longComputation()                              │
│     replyTo ! result  // 캡처된 reference 사용                  │
│   }                                                              │
│                                                                  │
│   ─────────────────────────────────────────────────────────────  │
│                                                                  │
│   3. 너무 많은 Actor ❌                                          │
│   ──────────────────                                            │
│   // 나쁜 예: 모든 것을 Actor로                                  │
│   class StringConcatActor ...  // 과도한 추상화                 │
│   class AddOneActor ...                                         │
│                                                                  │
│   // 좋은 예: 의미 있는 단위로                                   │
│   class OrderProcessor ...                                      │
│   class PaymentHandler ...                                      │
│                                                                  │
│   ─────────────────────────────────────────────────────────────  │
│                                                                  │
│   4. Ask 남용 ❌                                                 │
│   ────────────                                                  │
│   // 나쁜 예                                                     │
│   val r1 = await(actor1.ask(m1))                                │
│   val r2 = await(actor2.ask(m2))                                │
│   val r3 = await(actor3.ask(m3))  // 순차 실행, 비효율          │
│                                                                  │
│   // 좋은 예                                                     │
│   for {                                                          │
│     r1 <- actor1 ? m1                                           │
│     r2 <- actor2 ? m2                                           │
│     r3 <- actor3 ? m3                                           │
│   } yield combine(r1, r2, r3)  // 병렬 실행                     │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**상세 문서:** [안티패턴 가이드](./anti-patterns.md)

---

## 패턴 선택 가이드

| 문제 상황 | 추천 패턴 |
|----------|----------|
| 응답이 필요한 요청 | Request-Reply |
| 이벤트 통지 | Fire-and-Forget |
| 여러 소스에서 데이터 수집 | Scatter-Gather |
| 데이터 처리 파이프라인 | Pipe and Filter |
| 복잡한 상태 전이 | FSM |
| 동적 행동 변경 | Become/Unbecome |
| 초기화 중 메시지 보류 | Stash |
| 감사 추적 필요 | Event Sourcing |
| 읽기/쓰기 분리 | CQRS |
| 분산 트랜잭션 | Saga |
| 부하 분산 | Router |
| 외부 서비스 장애 격리 | Circuit Breaker |

## 관련 문서

- [이전: 사용 케이스](../10-use-cases/README.md)
- [핵심 개념](../02-core-concepts/README.md)
- [프레임워크 비교](../05-frameworks/README.md)
