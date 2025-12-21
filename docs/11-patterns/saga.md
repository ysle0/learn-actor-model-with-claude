# Saga 패턴

> 분산 시스템에서 트랜잭션을 관리하는 패턴

## 개념

분산 시스템에서는 전통적인 ACID 트랜잭션을 사용할 수 없습니다. Saga 패턴은 여러 서비스에 걸친 비즈니스 트랜잭션을 일련의 로컬 트랜잭션으로 분해하고, 실패 시 보상 트랜잭션(Compensating Transaction)을 실행합니다.

```
┌─────────────────────────────────────────────────────────────────┐
│                    Saga Transaction Flow                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   성공 시나리오:                                                 │
│   ┌────────┐   ┌────────┐   ┌────────┐   ┌────────┐            │
│   │  T1    │──▶│  T2    │──▶│  T3    │──▶│  T4    │ ✓ 완료     │
│   │ Order  │   │Payment │   │Inventory│   │Shipping│            │
│   └────────┘   └────────┘   └────────┘   └────────┘            │
│                                                                  │
│   실패 시나리오 (T3 실패):                                       │
│   ┌────────┐   ┌────────┐   ┌────────┐                         │
│   │  T1    │──▶│  T2    │──▶│  T3    │ ✗ 실패                  │
│   │ Order  │   │Payment │   │Inventory│                         │
│   └───┬────┘   └───┬────┘   └────────┘                         │
│       │            │                                             │
│       │◀───────────┘ C2: 결제 취소                              │
│       │◀── C1: 주문 취소                                        │
│       │                                                          │
│       ▼                                                          │
│   [롤백 완료]                                                    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## 두 가지 구현 방식

### 1. Choreography (분산 조율)

각 서비스가 이벤트를 발행하고 구독하여 자율적으로 동작합니다.

```
┌─────────────────────────────────────────────────────────────────┐
│                   Choreography Saga                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   ┌─────────┐   OrderCreated   ┌─────────┐                      │
│   │  Order  │ ────────────────▶│ Payment │                      │
│   │ Service │                  │ Service │                      │
│   └────┬────┘                  └────┬────┘                      │
│        │                            │                            │
│        │   OrderCancelled           │ PaymentCompleted           │
│        │◀───────────────            │                            │
│        │                            ▼                            │
│        │                       ┌─────────┐                      │
│        │ PaymentFailed         │Inventory│                      │
│        │◀──────────────────────│ Service │                      │
│        │                       └────┬────┘                      │
│        │                            │                            │
│        │                            │ InventoryReserved          │
│        │                            ▼                            │
│        │                       ┌─────────┐                      │
│        │ ShippingFailed        │Shipping │                      │
│        │◀──────────────────────│ Service │                      │
│        │                       └─────────┘                      │
│                                                                  │
│   장점: 느슨한 결합, 단순한 서비스                               │
│   단점: 흐름 추적 어려움, 순환 의존성 위험                       │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 2. Orchestration (중앙 조율)

중앙의 Saga Coordinator가 전체 흐름을 관리합니다.

```
┌─────────────────────────────────────────────────────────────────┐
│                   Orchestration Saga                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│                    ┌─────────────────┐                          │
│                    │      Saga       │                          │
│                    │   Coordinator   │                          │
│                    │     (Actor)     │                          │
│                    └────────┬────────┘                          │
│                             │                                    │
│         ┌───────────────────┼───────────────────┐               │
│         │                   │                   │               │
│         ▼                   ▼                   ▼               │
│    ┌─────────┐        ┌─────────┐        ┌─────────┐           │
│    │  Order  │        │ Payment │        │Inventory│           │
│    │ Service │        │ Service │        │ Service │           │
│    └─────────┘        └─────────┘        └─────────┘           │
│                                                                  │
│   장점: 명확한 흐름, 쉬운 모니터링                               │
│   단점: Coordinator가 단일 실패점이 될 수 있음                   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Actor 기반 구현

### Saga Coordinator Actor (TypeScript)

```typescript
// 메시지 타입
type SagaMessage =
  | { type: 'START_ORDER_SAGA'; orderId: string; items: Item[]; customerId: string }
  | { type: 'PAYMENT_SUCCESS'; orderId: string; transactionId: string }
  | { type: 'PAYMENT_FAILED'; orderId: string; reason: string }
  | { type: 'INVENTORY_RESERVED'; orderId: string }
  | { type: 'INVENTORY_FAILED'; orderId: string; reason: string }
  | { type: 'SHIPPING_SCHEDULED'; orderId: string; trackingId: string }
  | { type: 'SHIPPING_FAILED'; orderId: string; reason: string };

// Saga 상태
interface SagaState {
  orderId: string;
  status: 'PENDING' | 'PAYMENT_PENDING' | 'INVENTORY_PENDING' |
          'SHIPPING_PENDING' | 'COMPLETED' | 'COMPENSATING' | 'FAILED';
  paymentTransactionId?: string;
  inventoryReservationId?: string;
  compensationStep: number;
}

class OrderSagaActor extends Actor<SagaMessage> {
  private state: SagaState | null = null;

  protected async receive(message: SagaMessage): Promise<void> {
    switch (message.type) {
      case 'START_ORDER_SAGA':
        await this.startSaga(message);
        break;
      case 'PAYMENT_SUCCESS':
        await this.handlePaymentSuccess(message);
        break;
      case 'PAYMENT_FAILED':
        await this.startCompensation('payment', message.reason);
        break;
      case 'INVENTORY_RESERVED':
        await this.handleInventoryReserved(message);
        break;
      case 'INVENTORY_FAILED':
        await this.startCompensation('inventory', message.reason);
        break;
      case 'SHIPPING_SCHEDULED':
        await this.handleShippingScheduled(message);
        break;
      case 'SHIPPING_FAILED':
        await this.startCompensation('shipping', message.reason);
        break;
    }
  }

  private async startSaga(message: { orderId: string; items: Item[]; customerId: string }) {
    this.state = {
      orderId: message.orderId,
      status: 'PAYMENT_PENDING',
      compensationStep: 0
    };

    // Step 1: 결제 요청
    this.paymentService.send({
      type: 'PROCESS_PAYMENT',
      orderId: message.orderId,
      amount: this.calculateTotal(message.items),
      replyTo: this.self
    });

    console.log(`[Saga ${message.orderId}] Started - awaiting payment`);
  }

  private async handlePaymentSuccess(message: { transactionId: string }) {
    if (!this.state) return;

    this.state.paymentTransactionId = message.transactionId;
    this.state.status = 'INVENTORY_PENDING';

    // Step 2: 재고 예약
    this.inventoryService.send({
      type: 'RESERVE_INVENTORY',
      orderId: this.state.orderId,
      replyTo: this.self
    });

    console.log(`[Saga ${this.state.orderId}] Payment OK - reserving inventory`);
  }

  private async handleInventoryReserved(message: { orderId: string }) {
    if (!this.state) return;

    this.state.status = 'SHIPPING_PENDING';

    // Step 3: 배송 예약
    this.shippingService.send({
      type: 'SCHEDULE_SHIPPING',
      orderId: this.state.orderId,
      replyTo: this.self
    });

    console.log(`[Saga ${this.state.orderId}] Inventory reserved - scheduling shipping`);
  }

  private async handleShippingScheduled(message: { trackingId: string }) {
    if (!this.state) return;

    this.state.status = 'COMPLETED';

    // 성공 알림
    this.orderService.send({
      type: 'ORDER_COMPLETED',
      orderId: this.state.orderId,
      trackingId: message.trackingId
    });

    console.log(`[Saga ${this.state.orderId}] Completed successfully`);
  }

  private async startCompensation(failedStep: string, reason: string) {
    if (!this.state) return;

    console.log(`[Saga ${this.state.orderId}] Failed at ${failedStep}: ${reason}`);
    this.state.status = 'COMPENSATING';

    // 역순으로 보상 트랜잭션 실행
    switch (failedStep) {
      case 'shipping':
        // 재고 해제
        await this.compensateInventory();
        // fall through
      case 'inventory':
        // 결제 취소
        await this.compensatePayment();
        // fall through
      case 'payment':
        // 주문 취소
        await this.compensateOrder();
        break;
    }

    this.state.status = 'FAILED';
  }

  private async compensatePayment() {
    if (this.state?.paymentTransactionId) {
      this.paymentService.send({
        type: 'REFUND_PAYMENT',
        transactionId: this.state.paymentTransactionId
      });
      console.log(`[Saga ${this.state.orderId}] Refunding payment`);
    }
  }

  private async compensateInventory() {
    this.inventoryService.send({
      type: 'RELEASE_INVENTORY',
      orderId: this.state!.orderId
    });
    console.log(`[Saga ${this.state!.orderId}] Releasing inventory`);
  }

  private async compensateOrder() {
    this.orderService.send({
      type: 'CANCEL_ORDER',
      orderId: this.state!.orderId
    });
    console.log(`[Saga ${this.state!.orderId}] Cancelling order`);
  }
}
```

### Akka Persistence 기반 Saga (Scala)

```scala
import akka.persistence._

// 명령
sealed trait SagaCommand
case class StartOrderSaga(orderId: String, items: List[Item]) extends SagaCommand
case class PaymentResult(success: Boolean, transactionId: Option[String]) extends SagaCommand
case class InventoryResult(success: Boolean, reservationId: Option[String]) extends SagaCommand
case class ShippingResult(success: Boolean, trackingId: Option[String]) extends SagaCommand

// 이벤트
sealed trait SagaEvent
case class SagaStarted(orderId: String) extends SagaEvent
case class PaymentCompleted(transactionId: String) extends SagaEvent
case class PaymentFailed(reason: String) extends SagaEvent
case class InventoryReserved(reservationId: String) extends SagaEvent
case class InventoryFailed(reason: String) extends SagaEvent
case class ShippingScheduled(trackingId: String) extends SagaEvent
case class ShippingFailed(reason: String) extends SagaEvent
case class SagaCompleted() extends SagaEvent
case class SagaRolledBack() extends SagaEvent

// 상태
case class SagaState(
  orderId: String = "",
  step: String = "idle",
  paymentTxId: Option[String] = None,
  reservationId: Option[String] = None
)

class OrderSagaActor extends PersistentActor with ActorLogging {
  override def persistenceId: String = s"order-saga-${self.path.name}"

  var state = SagaState()

  def receiveCommand: Receive = idle

  def idle: Receive = {
    case StartOrderSaga(orderId, items) =>
      persist(SagaStarted(orderId)) { event =>
        updateState(event)
        context.become(awaitingPayment)
        paymentService ! ProcessPayment(orderId, calculateTotal(items))
      }
  }

  def awaitingPayment: Receive = {
    case PaymentResult(true, Some(txId)) =>
      persist(PaymentCompleted(txId)) { event =>
        updateState(event)
        context.become(awaitingInventory)
        inventoryService ! ReserveInventory(state.orderId)
      }

    case PaymentResult(false, _) =>
      persist(PaymentFailed("Payment declined")) { event =>
        updateState(event)
        rollback()
      }
  }

  def awaitingInventory: Receive = {
    case InventoryResult(true, Some(resId)) =>
      persist(InventoryReserved(resId)) { event =>
        updateState(event)
        context.become(awaitingShipping)
        shippingService ! ScheduleShipping(state.orderId)
      }

    case InventoryResult(false, _) =>
      persist(InventoryFailed("Out of stock")) { event =>
        updateState(event)
        rollback()
      }
  }

  def awaitingShipping: Receive = {
    case ShippingResult(true, Some(trackId)) =>
      persist(ShippingScheduled(trackId)) { event =>
        updateState(event)
        persist(SagaCompleted()) { _ =>
          log.info(s"Saga ${state.orderId} completed successfully")
          context.become(completed)
        }
      }

    case ShippingResult(false, _) =>
      persist(ShippingFailed("No carriers available")) { event =>
        updateState(event)
        rollback()
      }
  }

  def rollback(): Unit = {
    log.warning(s"Rolling back saga ${state.orderId}")

    // 역순 보상
    state.reservationId.foreach { resId =>
      inventoryService ! ReleaseReservation(resId)
    }

    state.paymentTxId.foreach { txId =>
      paymentService ! RefundPayment(txId)
    }

    orderService ! CancelOrder(state.orderId)

    persist(SagaRolledBack()) { _ =>
      context.become(failed)
    }
  }

  def receiveRecover: Receive = {
    case event: SagaEvent => updateState(event)
  }

  def updateState(event: SagaEvent): Unit = event match {
    case SagaStarted(orderId) =>
      state = state.copy(orderId = orderId, step = "started")
    case PaymentCompleted(txId) =>
      state = state.copy(paymentTxId = Some(txId), step = "payment_done")
    case InventoryReserved(resId) =>
      state = state.copy(reservationId = Some(resId), step = "inventory_done")
    case _ => // handle other events
  }
}
```

## Orleans 기반 Saga

```csharp
public interface IOrderSagaGrain : IGrainWithStringKey
{
    Task Start(OrderRequest request);
}

public class OrderSagaGrain : Grain, IOrderSagaGrain
{
    private readonly IPersistentState<SagaState> _state;

    public OrderSagaGrain(
        [PersistentState("saga", "sagaStore")]
        IPersistentState<SagaState> state)
    {
        _state = state;
    }

    public async Task Start(OrderRequest request)
    {
        _state.State.OrderId = request.OrderId;
        _state.State.Status = SagaStatus.PaymentPending;
        await _state.WriteStateAsync();

        try
        {
            // Step 1: Payment
            var paymentGrain = GrainFactory.GetGrain<IPaymentGrain>(request.OrderId);
            var paymentResult = await paymentGrain.ProcessPayment(request.Amount);

            if (!paymentResult.Success)
            {
                await Rollback("Payment failed");
                return;
            }

            _state.State.PaymentTransactionId = paymentResult.TransactionId;
            _state.State.Status = SagaStatus.InventoryPending;
            await _state.WriteStateAsync();

            // Step 2: Inventory
            var inventoryGrain = GrainFactory.GetGrain<IInventoryGrain>("global");
            var inventoryResult = await inventoryGrain.Reserve(request.Items);

            if (!inventoryResult.Success)
            {
                await Rollback("Inventory reservation failed");
                return;
            }

            _state.State.ReservationId = inventoryResult.ReservationId;
            _state.State.Status = SagaStatus.ShippingPending;
            await _state.WriteStateAsync();

            // Step 3: Shipping
            var shippingGrain = GrainFactory.GetGrain<IShippingGrain>(request.OrderId);
            var shippingResult = await shippingGrain.Schedule(request.Address);

            if (!shippingResult.Success)
            {
                await Rollback("Shipping scheduling failed");
                return;
            }

            _state.State.Status = SagaStatus.Completed;
            await _state.WriteStateAsync();
        }
        catch (Exception ex)
        {
            await Rollback($"Exception: {ex.Message}");
        }
    }

    private async Task Rollback(string reason)
    {
        _state.State.Status = SagaStatus.Compensating;
        await _state.WriteStateAsync();

        // Compensate in reverse order
        if (_state.State.ReservationId != null)
        {
            var inventoryGrain = GrainFactory.GetGrain<IInventoryGrain>("global");
            await inventoryGrain.Release(_state.State.ReservationId);
        }

        if (_state.State.PaymentTransactionId != null)
        {
            var paymentGrain = GrainFactory.GetGrain<IPaymentGrain>(_state.State.OrderId);
            await paymentGrain.Refund(_state.State.PaymentTransactionId);
        }

        var orderGrain = GrainFactory.GetGrain<IOrderGrain>(_state.State.OrderId);
        await orderGrain.Cancel(reason);

        _state.State.Status = SagaStatus.Failed;
        _state.State.FailureReason = reason;
        await _state.WriteStateAsync();
    }
}
```

## Saga 상태 다이어그램

```
┌─────────────────────────────────────────────────────────────────┐
│                    Saga State Diagram                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│                         ┌─────────┐                             │
│                         │  IDLE   │                             │
│                         └────┬────┘                             │
│                              │ start                             │
│                              ▼                                   │
│                    ┌──────────────────┐                         │
│                    │ PAYMENT_PENDING  │                         │
│                    └────────┬─────────┘                         │
│              success │      │ failure                            │
│                      ▼      └──────────────┐                    │
│            ┌──────────────────┐           │                     │
│            │ INVENTORY_PENDING│           │                     │
│            └────────┬─────────┘           │                     │
│              success │      │ failure     │                     │
│                      ▼      └──────┐      │                     │
│            ┌──────────────────┐    │      │                     │
│            │ SHIPPING_PENDING │    │      │                     │
│            └────────┬─────────┘    │      │                     │
│              success │      │ failure     │                     │
│                      ▼      └──────┐      │                     │
│                ┌──────────┐       │      │                     │
│                │ COMPLETED│       │      │                     │
│                └──────────┘       │      │                     │
│                                   ▼      ▼                     │
│                            ┌──────────────┐                     │
│                            │ COMPENSATING │                     │
│                            └──────┬───────┘                     │
│                                   │                              │
│                                   ▼                              │
│                            ┌──────────┐                         │
│                            │  FAILED  │                         │
│                            └──────────┘                         │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## 멱등성 (Idempotency)

Saga의 각 단계는 멱등성을 보장해야 합니다:

```typescript
class IdempotentPaymentService {
  private processedPayments = new Map<string, PaymentResult>();

  async processPayment(paymentId: string, amount: number): Promise<PaymentResult> {
    // 이미 처리된 결제인지 확인
    if (this.processedPayments.has(paymentId)) {
      return this.processedPayments.get(paymentId)!;
    }

    // 결제 처리
    const result = await this.doPayment(amount);

    // 결과 저장
    this.processedPayments.set(paymentId, result);

    return result;
  }
}
```

## 타임아웃과 재시도

```
┌─────────────────────────────────────────────────────────────────┐
│                Saga Timeout Handling                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   Saga Coordinator                                               │
│        │                                                         │
│        │──── Request ────▶ Service                              │
│        │                        │                               │
│        │ [Timeout Timer Start]  │                               │
│        │                        │ Processing...                 │
│        │                        │                               │
│   Timer│                        │                               │
│   Fires│                        │                               │
│        │◀── Timeout! ───────────┘                              │
│        │                                                         │
│        │ Options:                                                │
│        │ 1. Retry (with exponential backoff)                    │
│        │ 2. Compensate and fail                                 │
│        │ 3. Human intervention                                  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## 모니터링과 관측성

```typescript
interface SagaMetrics {
  sagaId: string;
  startTime: Date;
  currentStep: string;
  stepDurations: Map<string, number>;
  status: 'running' | 'completed' | 'failed';
  failureReason?: string;
}

class MonitoredSagaCoordinator {
  private metrics: SagaMetrics;

  async executeStep(stepName: string, action: () => Promise<void>) {
    const startTime = Date.now();
    this.metrics.currentStep = stepName;

    try {
      await action();
      this.metrics.stepDurations.set(stepName, Date.now() - startTime);
    } catch (error) {
      this.metrics.status = 'failed';
      this.metrics.failureReason = error.message;
      throw error;
    }
  }
}
```

## 장단점

### 장점
- 분산 트랜잭션 없이 일관성 유지
- 서비스 간 느슨한 결합
- 장기 실행 트랜잭션 지원
- 각 서비스의 로컬 ACID 트랜잭션 활용

### 단점
- 보상 로직 구현 복잡성
- 최종 일관성 (즉시 일관성 X)
- 디버깅 어려움
- 격리 레벨 제한

## 관련 패턴

- [Event Sourcing](./event-sourcing.md) - Saga 상태 저장
- [FSM](./fsm.md) - Saga 상태 관리
- [Circuit Breaker](./circuit-breaker.md) - 외부 서비스 호출 보호
