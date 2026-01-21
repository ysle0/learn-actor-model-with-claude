# Event Sourcing 패턴

> 상태 변경을 이벤트의 시퀀스로 저장하는 패턴

## 개념

Event Sourcing은 현재 상태를 직접 저장하는 대신, 상태 변경을 유발한 모든 이벤트를 순서대로 저장합니다. 현재 상태는 이벤트들을 순차적으로 적용(replay)하여 도출합니다.

```
┌─────────────────────────────────────────────────────────────────┐
│                   Traditional vs Event Sourcing                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   Traditional (상태 저장):                                       │
│   ┌─────────────────────┐                                       │
│   │  Account            │                                       │
│   │  ─────────────────  │                                       │
│   │  balance: $120      │  ← 현재 상태만 저장                   │
│   │  name: "John"       │                                       │
│   └─────────────────────┘                                       │
│                                                                  │
│   Event Sourcing (이벤트 저장):                                  │
│   ┌─────────────────────────────────────────────────────┐       │
│   │  Event Stream                                        │       │
│   │  ─────────────────────────────────────────────────   │       │
│   │  [AccountCreated] → [Deposited($100)] → ...          │       │
│   │  ... → [Withdrawn($30)] → [Deposited($50)]           │       │
│   │                                                      │       │
│   │  현재 상태 = $0 + $100 - $30 + $50 = $120            │       │
│   └─────────────────────────────────────────────────────┘       │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Event Sourcing vs State Sourcing

```
┌─────────────────────────────────────────────────────────────────┐
│              State Sourcing vs Event Sourcing 비교               │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   관점           State Sourcing         Event Sourcing          │
│   ────           ──────────────         ──────────────          │
│   저장 대상      현재 상태              이벤트 시퀀스            │
│   모델링 방식    좌표 기반              전이 기반                │
│   데이터 손실    이력 손실              이력 완전 보존           │
│   쿼리 방식      직접 조회              재생/프로젝션            │
│   일관성         즉시 일관성            최종 일관성              │
│   복잡도         낮음                   높음                     │
│   감사 추적      별도 구현 필요         내장                     │
│   시간 여행      불가능                 가능                     │
│                                                                  │
│   비유:                                                          │
│   ─────                                                          │
│   State: 은행 계좌 잔액 $120 (현재 상태)                        │
│   Event: 모든 입출금 거래 내역 (이벤트 로그)                    │
│          → 잔액은 거래 내역에서 언제든 재계산 가능               │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 언제 Event Sourcing을 사용할까?

```
┌─────────────────────────────────────────────────────────────────┐
│                    Event Sourcing 적합성 체크                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   ✅ 적합한 경우:                                                │
│   ─────────────                                                  │
│   • 감사 추적이 필수 (금융, 의료, 법률)                         │
│   • 복잡한 비즈니스 도메인                                       │
│   • 시간에 따른 상태 변화 분석 필요                             │
│   • 이벤트 기반 통합이 필요한 마이크로서비스                    │
│   • 예측 분석 (과거 데이터로 모델 학습)                         │
│   • 디버깅이 어려운 복잡한 시스템                               │
│                                                                  │
│   ❌ 부적합한 경우:                                              │
│   ─────────────                                                  │
│   • 단순 CRUD 애플리케이션                                       │
│   • 읽기 중심 워크로드                                           │
│   • 강한 즉시 일관성이 필수                                      │
│   • 팀이 패턴에 익숙하지 않음                                    │
│   • 빠른 프로토타이핑 필요                                       │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Actor Model과 Event Sourcing: 완벽한 조합

### 왜 잘 맞는가?

```
┌─────────────────────────────────────────────────────────────────┐
│          Actor Model + Event Sourcing = 자연스러운 결합          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   공통 개념 매핑:                                                │
│   ──────────────                                                 │
│                                                                  │
│   DDD 개념            Actor Model         Event Sourcing        │
│   ────────            ───────────         ──────────────        │
│   Aggregate Root  →   Actor           →   Event Stream          │
│   Command         →   Message         →   Command               │
│   Domain Event    →   Message         →   Event                 │
│   Identity        →   Actor Address   →   Stream ID             │
│   Lifecycle       →   Actor Lifecycle →   Event Sequence        │
│                                                                  │
│   시너지 효과:                                                   │
│   ────────────                                                   │
│   1. Actor = 단일 Aggregate Root 캡슐화                         │
│      → 일관성 경계가 명확                                       │
│                                                                  │
│   2. Message = Command/Event                                     │
│      → 이미 메시지 기반 설계                                    │
│                                                                  │
│   3. Mailbox = Command Queue                                     │
│      → 순서 보장 자동 처리                                      │
│                                                                  │
│   4. Single-Writer = Event Stream 무결성                        │
│      → 동시성 문제 자동 해결                                    │
│                                                                  │
│   5. Persistence ID = Stream ID                                  │
│      → 식별성 자연스럽게 연결                                   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Persistent Actor 아키텍처

```
┌─────────────────────────────────────────────────────────────────┐
│               Persistent Actor Architecture                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   ┌─────────────────────────────────────────────────────┐       │
│   │                 Persistent Actor                     │       │
│   │                                                      │       │
│   │   ┌──────────┐   ┌──────────────┐   ┌──────────┐   │       │
│   │   │ Command  │──▶│    State     │──▶│  Event   │   │       │
│   │   │ Handler  │   │   Mutation   │   │ Persist  │   │       │
│   │   └──────────┘   └──────────────┘   └────┬─────┘   │       │
│   │         ▲                                │         │       │
│   │         │                                │         │       │
│   │   ┌─────┴─────┐                          │         │       │
│   │   │  State    │◀─────────────────────────┤         │       │
│   │   │ (Memory)  │     Apply Event          │         │       │
│   │   └───────────┘                          │         │       │
│   └──────────────────────────────────────────┼─────────┘       │
│                                              │                  │
│                   Recovery 시 Replay         ▼                  │
│                               ┌──────────────────────┐          │
│                               │    Event Journal     │          │
│                               │  ┌────────────────┐  │          │
│                               │  │ Event 1        │  │          │
│                               │  │ Event 2        │  │          │
│                               │  │ ...            │  │          │
│                               │  │ Event N        │  │          │
│                               │  └────────────────┘  │          │
│                               └──────────────────────┘          │
│                                                                  │
│   처리 흐름:                                                    │
│   ──────────                                                    │
│   1. Command 수신                                               │
│   2. 현재 State로 유효성 검증                                   │
│   3. Event 생성                                                 │
│   4. Event를 Journal에 저장                                     │
│   5. 저장 성공 후 State에 Event 적용                           │
│   6. 응답 반환                                                  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## CQRS와의 결합

```
┌─────────────────────────────────────────────────────────────────┐
│              CQRS + Event Sourcing + Actor Model                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   CQRS: Command Query Responsibility Segregation                │
│   ────  명령(쓰기)과 질의(읽기)를 분리                          │
│                                                                  │
│                        ┌─────────────┐                          │
│                        │   Client    │                          │
│                        └──────┬──────┘                          │
│                               │                                  │
│              ┌────────────────┴────────────────┐                │
│              │                                 │                 │
│      ┌───────▼───────┐                 ┌───────▼───────┐        │
│      │   Commands    │                 │    Queries    │        │
│      │   (Write)     │                 │    (Read)     │        │
│      └───────┬───────┘                 └───────┬───────┘        │
│              │                                 │                 │
│      ┌───────▼───────┐                 ┌───────▼───────┐        │
│      │  Persistent   │                 │  Read Model   │        │
│      │   Actors      │                 │   Service     │        │
│      │               │                 │               │        │
│      │ ┌───┐ ┌───┐   │                 │  ┌─────────┐  │        │
│      │ │ A │ │ A │   │   Events       │  │ View 1  │  │        │
│      │ └───┘ └───┘   │ ──────────────▶│  │ View 2  │  │        │
│      └───────┬───────┘   Projection    │  │ View 3  │  │        │
│              │                         │  └─────────┘  │        │
│      ┌───────▼───────┐                 └───────────────┘        │
│      │ Event Store   │                                          │
│      │ ┌───────────┐ │                                          │
│      │ │ Stream 1  │ │                                          │
│      │ │ Stream 2  │ │                                          │
│      │ └───────────┘ │                                          │
│      └───────────────┘                                          │
│                                                                  │
│   장점:                                                          │
│   ─────                                                          │
│   • 쓰기: Actor가 순차적으로 처리 (일관성)                      │
│   • 읽기: 비정규화된 뷰로 고성능 조회                           │
│   • 분리: 독립적인 스케일링 가능                                │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 프레임워크별 구현

### Akka Persistence (Scala/Java)

```scala
import akka.persistence.typed.scaladsl._
import akka.persistence.typed.PersistenceId

// 명령 (Commands)
sealed trait AccountCommand
case class Deposit(amount: BigDecimal) extends AccountCommand
case class Withdraw(amount: BigDecimal) extends AccountCommand
case object GetBalance extends AccountCommand

// 이벤트 (Events) - 불변
sealed trait AccountEvent
case class Deposited(amount: BigDecimal) extends AccountEvent
case class Withdrawn(amount: BigDecimal) extends AccountEvent

// 상태 (State)
case class AccountState(balance: BigDecimal = 0) {
  def applyEvent(event: AccountEvent): AccountState = event match {
    case Deposited(amount) => copy(balance = balance + amount)
    case Withdrawn(amount) => copy(balance = balance - amount)
  }
}

// EventSourcedBehavior - Akka Typed 권장 방식
object AccountActor {
  def apply(accountId: String): Behavior[AccountCommand] = {
    EventSourcedBehavior[AccountCommand, AccountEvent, AccountState](
      persistenceId = PersistenceId.ofUniqueId(s"account-$accountId"),
      emptyState = AccountState(),
      commandHandler = (state, command) => commandHandler(state, command),
      eventHandler = (state, event) => state.applyEvent(event)
    )
  }

  private def commandHandler(
    state: AccountState,
    command: AccountCommand
  ): Effect[AccountEvent, AccountState] = command match {

    case Deposit(amount) if amount > 0 =>
      Effect
        .persist(Deposited(amount))
        .thenReply(replyTo)(_ => Done)

    case Withdraw(amount) if amount > 0 && amount <= state.balance =>
      Effect
        .persist(Withdrawn(amount))
        .thenReply(replyTo)(_ => Done)

    case Withdraw(amount) if amount > state.balance =>
      Effect.reply(replyTo)(InsufficientFunds(state.balance, amount))

    case GetBalance =>
      Effect.reply(replyTo)(state.balance)
  }
}
```

### Orleans JournaledGrain (C#)

```csharp
// 이벤트 정의
public abstract record AccountEvent;
public record Deposited(decimal Amount, DateTime Timestamp) : AccountEvent;
public record Withdrawn(decimal Amount, DateTime Timestamp) : AccountEvent;

// 상태 정의
[Serializable]
public class AccountState
{
    public decimal Balance { get; set; }

    public AccountState Apply(AccountEvent @event) => @event switch
    {
        Deposited e => this with { Balance = Balance + e.Amount },
        Withdrawn e => this with { Balance = Balance - e.Amount },
        _ => this
    };
}

// JournaledGrain - Orleans의 Event Sourcing 지원
public class AccountGrain : JournaledGrain<AccountState, AccountEvent>, IAccountGrain
{
    public async Task<decimal> Deposit(decimal amount)
    {
        // RaiseEvent: 이벤트 생성 및 상태 자동 업데이트
        RaiseEvent(new Deposited(amount, DateTime.UtcNow));

        // ConfirmEvents: 이벤트가 저장될 때까지 대기
        await ConfirmEvents();

        return State.Balance;
    }

    public async Task<decimal> Withdraw(decimal amount)
    {
        if (amount > State.Balance)
            throw new InsufficientFundsException();

        RaiseEvent(new Withdrawn(amount, DateTime.UtcNow));
        await ConfirmEvents();

        return State.Balance;
    }

    public Task<decimal> GetBalance() => Task.FromResult(State.Balance);

    // 여러 이벤트 동시 발생 (원자적)
    public async Task Transfer(IAccountGrain target, decimal amount)
    {
        // 로컬 출금
        RaiseEvent(new Withdrawn(amount, DateTime.UtcNow));

        // 확인 후 대상에 입금
        await ConfirmEvents();
        await target.Deposit(amount);
    }
}
```

### Akka.NET Persistence (C#)

```csharp
// Akka.NET Persistent Actor
public class AccountActor : ReceivePersistentActor
{
    private AccountState _state = new();

    public override string PersistenceId => $"account-{Self.Path.Name}";

    public AccountActor()
    {
        // Command Handler
        Command<Deposit>(cmd =>
        {
            if (cmd.Amount <= 0)
            {
                Sender.Tell(new InvalidAmount());
                return;
            }

            var evt = new Deposited(cmd.Amount, DateTime.UtcNow);

            Persist(evt, e =>
            {
                _state = _state.Apply(e);
                Sender.Tell(new DepositSuccess(_state.Balance));

                // 100개 이벤트마다 스냅샷
                if (LastSequenceNr % 100 == 0)
                    SaveSnapshot(_state);
            });
        });

        Command<Withdraw>(cmd =>
        {
            if (cmd.Amount > _state.Balance)
            {
                Sender.Tell(new InsufficientFunds(_state.Balance));
                return;
            }

            var evt = new Withdrawn(cmd.Amount, DateTime.UtcNow);

            Persist(evt, e =>
            {
                _state = _state.Apply(e);
                Sender.Tell(new WithdrawSuccess(_state.Balance));
            });
        });

        Command<GetBalance>(_ => Sender.Tell(_state.Balance));

        // Recovery Handler
        Recover<AccountEvent>(evt => _state = _state.Apply(evt));
        Recover<SnapshotOffer>(offer => _state = (AccountState)offer.Snapshot);
    }
}
```

### Proto.Actor (Go)

```go
// Proto.Actor with Event Sourcing

// 이벤트 정의
type Deposited struct {
    Amount    float64
    Timestamp time.Time
}

type Withdrawn struct {
    Amount    float64
    Timestamp time.Time
}

// 상태
type AccountState struct {
    Balance float64
}

func (s *AccountState) Apply(event interface{}) {
    switch e := event.(type) {
    case *Deposited:
        s.Balance += e.Amount
    case *Withdrawn:
        s.Balance -= e.Amount
    }
}

// Persistent Actor
type AccountActor struct {
    persistence.Mixin  // Event Sourcing 지원
    state AccountState
}

func (a *AccountActor) Receive(ctx actor.Context) {
    switch msg := ctx.Message().(type) {
    case *persistence.RequestSnapshot:
        a.PersistSnapshot(&a.state)

    case *persistence.ReplayEvent:
        a.state.Apply(msg.Event())

    case *Deposit:
        event := &Deposited{Amount: msg.Amount, Timestamp: time.Now()}
        a.PersistReceive(event)
        a.state.Apply(event)
        ctx.Respond(&DepositSuccess{Balance: a.state.Balance})

    case *Withdraw:
        if msg.Amount > a.state.Balance {
            ctx.Respond(&InsufficientFunds{Balance: a.state.Balance})
            return
        }
        event := &Withdrawn{Amount: msg.Amount, Timestamp: time.Now()}
        a.PersistReceive(event)
        a.state.Apply(event)
        ctx.Respond(&WithdrawSuccess{Balance: a.state.Balance})

    case *GetBalance:
        ctx.Respond(&BalanceResponse{Balance: a.state.Balance})
    }
}
```

---

## Best Practices

### 1. 이벤트 설계

```
┌─────────────────────────────────────────────────────────────────┐
│                    이벤트 설계 Best Practices                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   ✅ 좋은 이벤트:                                                │
│   ──────────────                                                 │
│   • 과거형 이름 사용 (OrderCreated, PaymentProcessed)            │
│   • 비즈니스 의미 담기 (UserBanned vs UserStatusChanged)        │
│   • 불변 (immutable)                                            │
│   • 자기 충족적 (필요한 데이터 모두 포함)                       │
│   • 버전 관리 고려                                               │
│                                                                  │
│   ❌ 나쁜 이벤트:                                                │
│   ──────────────                                                 │
│   • 기술적 이름 (DataUpdated, RecordModified)                   │
│   • 너무 세분화 (FieldXChanged, FieldYChanged)                  │
│   • 외부 참조 의존 (userId만 있고 userName 없음)                │
│   • 가변 객체 포함                                               │
│                                                                  │
│   예시:                                                          │
│   ─────                                                          │
│   // 나쁨: 너무 일반적                                          │
│   record OrderUpdated(string Field, object Value);               │
│                                                                  │
│   // 좋음: 비즈니스 의미 명확                                   │
│   record OrderShipped(                                           │
│       string OrderId,                                            │
│       string TrackingNumber,                                     │
│       string Carrier,                                            │
│       DateTime ShippedAt                                         │
│   );                                                             │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 2. 스냅샷 전략

```
┌─────────────────────────────────────────────────────────────────┐
│                    Snapshot Best Practices                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   스냅샷 시점 결정:                                              │
│   ────────────────                                               │
│   • 이벤트 개수 기반: 100개마다 스냅샷                          │
│   • 시간 기반: 1시간마다 스냅샷                                  │
│   • 복합: 50개 OR 30분 중 먼저 도달                             │
│                                                                  │
│   스냅샷 정리:                                                   │
│   ────────────                                                   │
│   • 오래된 스냅샷 삭제 (최근 N개만 유지)                        │
│   • 스냅샷 이전 이벤트 삭제 (선택적)                            │
│                                                                  │
│   주의사항:                                                      │
│   ─────────                                                      │
│   • 스냅샷도 버전 관리 필요                                     │
│   • 스냅샷 실패 시 이벤트만으로 복구 가능해야 함                │
│   • 스냅샷 저장은 비동기로                                      │
│                                                                  │
│   코드 예시:                                                     │
│   ──────────                                                     │
│   // Akka Persistence                                            │
│   if (LastSequenceNr % 100 == 0 && LastSequenceNr > 0)          │
│   {                                                              │
│       SaveSnapshot(_state);                                      │
│   }                                                              │
│                                                                  │
│   // 스냅샷 성공 후 오래된 데이터 정리                          │
│   Recover<SaveSnapshotSuccess>(success =>                        │
│   {                                                              │
│       DeleteMessages(success.Metadata.SequenceNr);               │
│       DeleteSnapshots(new SnapshotSelectionCriteria(            │
│           success.Metadata.SequenceNr - 1));                     │
│   });                                                            │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 3. Aggregate 수명주기 관리

```
┌─────────────────────────────────────────────────────────────────┐
│               Aggregate Lifecycle Best Practices                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   수명주기 정의:                                                 │
│   ──────────────                                                 │
│   비즈니스에 맞는 명확한 수명주기 설계                          │
│                                                                  │
│   예: 쇼핑 카트                                                 │
│   ┌─────────┐   상품    ┌─────────┐   결제    ┌─────────┐      │
│   │ Created │ ────────▶ │ Active  │ ────────▶ │ Closed  │      │
│   └─────────┘   추가    └────┬────┘   완료    └─────────┘      │
│                              │                                   │
│                              │ 30분 비활성                       │
│                              ▼                                   │
│                        ┌──────────┐                             │
│                        │ Abandoned│                             │
│                        └──────────┘                             │
│                                                                  │
│   Passivation (비활성화):                                        │
│   ────────────────────────                                       │
│   • 메모리에서 제거하고 필요시 이벤트 재생으로 복원             │
│   • 비활성 시간 기준 설정 (예: 15분)                            │
│   • Cluster Sharding과 함께 사용                                │
│                                                                  │
│   // Akka Cluster Sharding                                       │
│   ClusterSharding(system).start(                                 │
│     typeName = "Account",                                        │
│     entityProps = AccountActor.props(),                          │
│     settings = ClusterShardingSettings(system)                   │
│       .withPassivateIdleEntityAfter(15.minutes)                  │
│   )                                                              │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 4. 이벤트 스키마 진화

```
┌─────────────────────────────────────────────────────────────────┐
│               Event Schema Evolution Strategies                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   문제:                                                          │
│   ─────                                                          │
│   이벤트는 영구 저장됨 → 스키마 변경 시 기존 이벤트 처리 필요   │
│                                                                  │
│   전략 1: Upcasting (이벤트 변환)                               │
│   ─────────────────────────────────                              │
│   저장소에서 읽을 때 새 버전으로 변환                           │
│                                                                  │
│   // V1 → V2 변환                                                │
│   class OrderCreatedV1Upcaster : IEventAdapter {                 │
│       public IEvent Adapt(IEvent evt) {                          │
│           if (evt is OrderCreatedV1 v1)                          │
│               return new OrderCreatedV2(                         │
│                   v1.OrderId,                                    │
│                   v1.CustomerId,                                 │
│                   Currency: "USD"  // 새 필드 기본값             │
│               );                                                 │
│           return evt;                                            │
│       }                                                          │
│   }                                                              │
│                                                                  │
│   전략 2: 버전 필드 포함                                        │
│   ──────────────────────                                         │
│   record OrderCreated(                                           │
│       int Version,  // 스키마 버전                               │
│       string OrderId,                                            │
│       ...                                                        │
│   );                                                             │
│                                                                  │
│   전략 3: 이벤트 타입 버전                                      │
│   ──────────────────────                                         │
│   OrderCreated_V1, OrderCreated_V2 별도 타입                    │
│                                                                  │
│   권장사항:                                                      │
│   ─────────                                                      │
│   • 필드 추가는 안전 (기본값 사용)                              │
│   • 필드 제거/이름변경은 Upcaster 필요                          │
│   • 의미 변경은 새 이벤트 타입 생성                             │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 5. 프로젝션 패턴

```
┌─────────────────────────────────────────────────────────────────┐
│                    Projection Best Practices                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   Event Stream:                                                  │
│   [OrderCreated] → [ItemAdded] → [ItemAdded] → [OrderShipped]   │
│                                                                  │
│          │              │              │              │          │
│          ▼              ▼              ▼              ▼          │
│   ┌──────────────────────────────────────────────────────┐      │
│   │                    Projector                          │      │
│   │                                                       │      │
│   │  • 이벤트 필터링                                      │      │
│   │  • 읽기 모델 업데이트                                 │      │
│   │  • 멱등성 보장                                        │      │
│   └──────────────────────────────────────────────────────┘      │
│                                                                  │
│          │              │              │                         │
│          ▼              ▼              ▼                         │
│   ┌──────────┐   ┌──────────┐   ┌──────────┐                   │
│   │ 주문 목록│   │ 고객별   │   │ 분석     │                   │
│   │ (List)   │   │ 이력     │   │ 리포트   │                   │
│   └──────────┘   └──────────┘   └──────────┘                   │
│                                                                  │
│   구현 패턴:                                                     │
│   ──────────                                                     │
│   // 멱등성 있는 Projector                                       │
│   class OrderSummaryProjection : IProjection {                   │
│       private readonly IProjectionStore _store;                  │
│                                                                  │
│       public async Task Handle(OrderCreated evt) {               │
│           // Upsert로 중복 처리 안전                             │
│           await _store.Upsert(new OrderSummary {                 │
│               OrderId = evt.OrderId,                             │
│               Version = evt.SequenceNr,  // 버전 추적            │
│               ...                                                │
│           });                                                    │
│       }                                                          │
│                                                                  │
│       public async Task Handle(ItemAdded evt) {                  │
│           var summary = await _store.Get(evt.OrderId);           │
│           if (evt.SequenceNr <= summary.Version)                 │
│               return;  // 이미 처리됨                            │
│                                                                  │
│           summary.TotalItems++;                                  │
│           summary.Version = evt.SequenceNr;                      │
│           await _store.Update(summary);                          │
│       }                                                          │
│   }                                                              │
│                                                                  │
│   Best Practices:                                                │
│   ───────────────                                                │
│   • 멱등성 필수 (중복 처리 안전)                                │
│   • 프로젝션 오프셋 추적                                        │
│   • 프로젝션 재구축 가능하게 설계                               │
│   • 프로젝션별 독립적 진행                                      │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 실전 아키텍처 예시

### 게임 서버에서의 적용

```
┌─────────────────────────────────────────────────────────────────┐
│            게임 서버 Event Sourcing Architecture                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   ┌─────────────────────────────────────────────────────┐       │
│   │                    Game Cluster                      │       │
│   │                                                      │       │
│   │  ┌──────────────┐  ┌──────────────┐  ┌───────────┐ │       │
│   │  │ PlayerActor  │  │ PlayerActor  │  │ RoomActor │ │       │
│   │  │ (Persistent) │  │ (Persistent) │  │(Persistent│ │       │
│   │  └──────┬───────┘  └──────┬───────┘  └─────┬─────┘ │       │
│   │         │                 │                │        │       │
│   └─────────┼─────────────────┼────────────────┼────────┘       │
│             │                 │                │                 │
│             ▼                 ▼                ▼                 │
│   ┌─────────────────────────────────────────────────────┐       │
│   │                   Event Store                        │       │
│   │                                                      │       │
│   │  player-123:                                         │       │
│   │  [Joined] → [ItemAcquired] → [LevelUp] → ...        │       │
│   │                                                      │       │
│   │  room-456:                                           │       │
│   │  [Created] → [PlayerJoined] → [GameStarted] → ...   │       │
│   │                                                      │       │
│   └───────────────────────┬─────────────────────────────┘       │
│                           │                                      │
│             ┌─────────────┴─────────────┐                       │
│             │                           │                        │
│             ▼                           ▼                        │
│   ┌──────────────────┐        ┌──────────────────┐              │
│   │  Leaderboard     │        │  Analytics       │              │
│   │  Projection      │        │  Projection      │              │
│   │                  │        │                  │              │
│   │  • 실시간 순위   │        │  • 게임 통계     │              │
│   │  • 레벨별 분포   │        │  • 행동 분석     │              │
│   └──────────────────┘        └──────────────────┘              │
│                                                                  │
│   장점:                                                          │
│   ─────                                                          │
│   • 플레이어 행동 완전 추적 (치팅 탐지)                         │
│   • 특정 시점 상태 복원 (롤백)                                  │
│   • 이벤트 재생으로 버그 재현                                   │
│   • 분석 데이터 풍부                                            │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 이벤트 저장소 선택

```
┌─────────────────────────────────────────────────────────────────┐
│                    Event Store Options                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   EventStoreDB (전용 이벤트 저장소):                             │
│   ├── 이벤트 소싱 전용 설계                                      │
│   ├── 스트림 기반 저장                                           │
│   ├── 내장 프로젝션 지원                                         │
│   └── 고성능 append-only                                         │
│                                                                  │
│   PostgreSQL + Marten:                                           │
│   ├── 기존 RDBMS 활용                                            │
│   ├── JSONB로 이벤트 저장                                        │
│   └── 트랜잭션 지원                                              │
│                                                                  │
│   Cassandra:                                                     │
│   ├── 고가용성                                                   │
│   ├── 수평 확장                                                  │
│   └── 시계열 데이터에 적합                                       │
│                                                                  │
│   Azure Table Storage / CosmosDB:                                │
│   ├── 클라우드 네이티브                                          │
│   ├── 자동 스케일링                                              │
│   └── Orleans와 통합 용이                                        │
│                                                                  │
│   Kafka (메시지 브로커):                                         │
│   ├── 이벤트 스트리밍                                            │
│   ├── 높은 처리량                                                │
│   └── 컨슈머 그룹으로 프로젝션                                   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 장단점 요약

### 장점

| 장점 | 설명 |
|-----|------|
| 완전한 감사 이력 | 모든 변경 기록 보존, 규제 준수 |
| 시간 여행 | 특정 시점의 상태 복원 가능 |
| 디버깅 용이 | 이벤트 재생으로 버그 재현 |
| 느슨한 결합 | 이벤트 기반 서비스 통합 |
| 테스트 용이 | Given-When-Then 스타일 테스트 |
| 확장성 | CQRS와 결합 시 읽기/쓰기 독립 스케일링 |

### 단점

| 단점 | 해결책 |
|-----|--------|
| 복잡성 증가 | 점진적 도입, 핵심 도메인에만 적용 |
| 학습 곡선 | 팀 교육, 작은 프로젝트로 시작 |
| 최종 일관성 | 사용자 기대치 관리, UI에서 명시 |
| 이벤트 스키마 진화 | Upcaster 패턴, 버전 관리 |
| 쿼리 복잡성 | 프로젝션/읽기 모델 활용 |

---

## 관련 패턴

- [CQRS](./cqrs.md) - Event Sourcing과 함께 사용
- [Saga](./saga.md) - 분산 트랜잭션
- [Stash](./stash.md) - 이벤트 버퍼링

## 참고 자료

- [Event Sourcing - Martin Fowler](https://martinfowler.com/eaaDev/EventSourcing.html)
- [CQRS Pattern - Microsoft Learn](https://learn.microsoft.com/en-us/azure/architecture/patterns/cqrs)
- [Event Sourcing Pattern - Microsoft Learn](https://learn.microsoft.com/en-us/azure/architecture/patterns/event-sourcing)
- [Akka Persistence Documentation](https://doc.akka.io/libraries/akka-core/current/typed/persistence.html)
- [Orleans JournaledGrain - Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/orleans/grains/event-sourcing/journaledgrain-basics)
- [Microservices.io - Event Sourcing Pattern](https://microservices.io/patterns/data/event-sourcing.html)
