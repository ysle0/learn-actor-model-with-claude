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

## Actor와 Event Sourcing

Actor Model과 Event Sourcing은 자연스럽게 결합됩니다:

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
│   │                                          │         │       │
│   └──────────────────────────────────────────┼─────────┘       │
│                                              │                  │
│                                              ▼                  │
│                               ┌──────────────────────┐          │
│                               │    Event Journal     │          │
│                               │  (Persistent Store)  │          │
│                               └──────────────────────┘          │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Akka Persistence 구현

### 기본 구조

```scala
import akka.persistence._

// 명령 (Commands)
sealed trait AccountCommand
case class Deposit(amount: BigDecimal) extends AccountCommand
case class Withdraw(amount: BigDecimal) extends AccountCommand
case object GetBalance extends AccountCommand

// 이벤트 (Events)
sealed trait AccountEvent
case class Deposited(amount: BigDecimal) extends AccountEvent
case class Withdrawn(amount: BigDecimal) extends AccountEvent

// 상태 (State)
case class AccountState(balance: BigDecimal = 0) {
  def updated(event: AccountEvent): AccountState = event match {
    case Deposited(amount) => copy(balance = balance + amount)
    case Withdrawn(amount) => copy(balance = balance - amount)
  }
}

// Persistent Actor
class AccountActor(accountId: String) extends PersistentActor {
  override def persistenceId: String = s"account-$accountId"

  var state = AccountState()

  // 명령 처리
  override def receiveCommand: Receive = {
    case Deposit(amount) if amount > 0 =>
      persist(Deposited(amount)) { event =>
        state = state.updated(event)
        sender() ! state.balance
      }

    case Withdraw(amount) if amount > 0 && amount <= state.balance =>
      persist(Withdrawn(amount)) { event =>
        state = state.updated(event)
        sender() ! state.balance
      }

    case Withdraw(amount) if amount > state.balance =>
      sender() ! InsufficientFunds(state.balance, amount)

    case GetBalance =>
      sender() ! state.balance
  }

  // 복구 (Recovery)
  override def receiveRecover: Receive = {
    case event: AccountEvent =>
      state = state.updated(event)

    case SnapshotOffer(_, snapshot: AccountState) =>
      state = snapshot

    case RecoveryCompleted =>
      log.info(s"Recovery completed. Balance: ${state.balance}")
  }
}
```

### Snapshot 최적화

많은 이벤트가 누적되면 복구 시간이 길어집니다. Snapshot으로 이를 최적화합니다:

```scala
class AccountActorWithSnapshot(accountId: String) extends PersistentActor {
  override def persistenceId: String = s"account-$accountId"

  var state = AccountState()
  var eventsSinceLastSnapshot = 0

  override def receiveCommand: Receive = {
    case Deposit(amount) =>
      persist(Deposited(amount)) { event =>
        state = state.updated(event)
        eventsSinceLastSnapshot += 1
        maybeSnapshot()
        sender() ! state.balance
      }
    // ... 다른 명령들
  }

  private def maybeSnapshot(): Unit = {
    if (eventsSinceLastSnapshot >= 100) {  // 100개 이벤트마다
      saveSnapshot(state)
      eventsSinceLastSnapshot = 0
    }
  }

  override def receiveRecover: Receive = {
    case SnapshotOffer(metadata, snapshot: AccountState) =>
      log.info(s"Recovering from snapshot at seq ${metadata.sequenceNr}")
      state = snapshot

    case event: AccountEvent =>
      state = state.updated(event)
  }
}
```

```
┌─────────────────────────────────────────────────────────────────┐
│                    Recovery with Snapshot                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   Without Snapshot:                                              │
│   [E1] → [E2] → [E3] → ... → [E999] → [E1000]                   │
│    └─────────────────────────────────────────┘                  │
│           모든 이벤트 replay (느림)                              │
│                                                                  │
│   With Snapshot:                                                 │
│   [E1] → ... → [E100] → [SNAPSHOT] → [E101] → ... → [E200]      │
│                    │         └──────────────────────┘           │
│                    │         최신 snapshot 이후만 replay        │
│                    └── 스냅샷에서 상태 복원 (빠름)               │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Orleans Persistent Grain

```csharp
public interface IAccountGrain : IGrainWithStringKey
{
    Task<decimal> Deposit(decimal amount);
    Task<decimal> Withdraw(decimal amount);
    Task<decimal> GetBalance();
}

[Serializable]
public class AccountState
{
    public decimal Balance { get; set; }
    public List<AccountEvent> Events { get; set; } = new();
}

public class AccountGrain : Grain, IAccountGrain
{
    private readonly IPersistentState<AccountState> _state;

    public AccountGrain(
        [PersistentState("account", "accountStore")]
        IPersistentState<AccountState> state)
    {
        _state = state;
    }

    public async Task<decimal> Deposit(decimal amount)
    {
        var evt = new Deposited(amount, DateTime.UtcNow);
        _state.State.Events.Add(evt);
        _state.State.Balance += amount;

        await _state.WriteStateAsync();
        return _state.State.Balance;
    }

    public async Task<decimal> Withdraw(decimal amount)
    {
        if (amount > _state.State.Balance)
            throw new InsufficientFundsException();

        var evt = new Withdrawn(amount, DateTime.UtcNow);
        _state.State.Events.Add(evt);
        _state.State.Balance -= amount;

        await _state.WriteStateAsync();
        return _state.State.Balance;
    }

    public Task<decimal> GetBalance() =>
        Task.FromResult(_state.State.Balance);
}
```

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
└─────────────────────────────────────────────────────────────────┘
```

## Projection (투영)

이벤트 스트림에서 읽기 모델 생성:

```
┌─────────────────────────────────────────────────────────────────┐
│                      Event Projection                            │
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
│   │  • 여러 뷰 생성                                       │      │
│   └──────────────────────────────────────────────────────┘      │
│                                                                  │
│          │              │              │                         │
│          ▼              ▼              ▼                         │
│   ┌──────────┐   ┌──────────┐   ┌──────────┐                   │
│   │ Order    │   │ Customer │   │ Analytics│                   │
│   │ Summary  │   │ History  │   │ Report   │                   │
│   │  View    │   │  View    │   │  View    │                   │
│   └──────────┘   └──────────┘   └──────────┘                   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

```csharp
// Projection 예시
public class OrderSummaryProjection
{
    private readonly IReadModelStore _store;

    public async Task Handle(OrderCreated evt)
    {
        await _store.Insert(new OrderSummary
        {
            OrderId = evt.OrderId,
            CustomerId = evt.CustomerId,
            Status = "Created",
            TotalItems = 0,
            TotalAmount = 0
        });
    }

    public async Task Handle(ItemAdded evt)
    {
        var summary = await _store.Get<OrderSummary>(evt.OrderId);
        summary.TotalItems++;
        summary.TotalAmount += evt.Price;
        await _store.Update(summary);
    }

    public async Task Handle(OrderShipped evt)
    {
        var summary = await _store.Get<OrderSummary>(evt.OrderId);
        summary.Status = "Shipped";
        summary.ShippedAt = evt.Timestamp;
        await _store.Update(summary);
    }
}
```

## 장단점

### 장점

1. **완전한 감사 이력**
   - 모든 변경 기록 보존
   - 규제 준수 (금융, 의료)

2. **시간 여행**
   - 특정 시점의 상태 복원
   - 디버깅 용이

3. **이벤트 재생**
   - 버그 재현 가능
   - 새로운 프로젝션 생성

4. **느슨한 결합**
   - 이벤트 기반 통합
   - 서비스 독립적 발전

### 단점

1. **복잡성 증가**
   - 학습 곡선
   - 이벤트 스키마 진화

2. **최종 일관성**
   - 즉각적 일관성 어려움
   - 읽기 모델 지연

3. **이벤트 저장소 필요**
   - 추가 인프라
   - 운영 복잡성

## 사용 사례

| 적합한 경우 | 부적합한 경우 |
|------------|--------------|
| 감사 추적 필수 | 단순 CRUD |
| 복잡한 도메인 | 읽기 중심 워크로드 |
| 이벤트 기반 아키텍처 | 강한 일관성 필요 |
| 분석/리포팅 중요 | 작은 규모 시스템 |

## 관련 패턴

- [CQRS](./cqrs.md) - Event Sourcing과 함께 사용
- [Saga](./saga.md) - 분산 트랜잭션
- [Stash](./stash.md) - 이벤트 버퍼링
