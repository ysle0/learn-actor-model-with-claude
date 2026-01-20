/**
 * Message Passing Patterns - Tell, Ask, Forward
 *
 * Actor 간 메시지 통신의 핵심 패턴을 구현합니다.
 */

// ============================================
// Actor System 기본 인프라
// ============================================

type ActorRef = { send: (msg: any) => void; ask: <T>(msg: any) => Promise<T> };

class ActorSystem {
  private actors = new Map<string, Actor<any>>();

  spawn<T>(name: string, actor: Actor<T>): ActorRef {
    this.actors.set(name, actor);
    actor.setSystem(this, name);

    return {
      send: (msg: T) => actor.send(msg),
      ask: <R>(msg: T) => actor.ask<R>(msg),
    };
  }

  getActor(name: string): ActorRef | undefined {
    const actor = this.actors.get(name);
    if (!actor) return undefined;

    return {
      send: (msg: any) => actor.send(msg),
      ask: <R>(msg: any) => actor.ask<R>(msg),
    };
  }
}

abstract class Actor<T> {
  private mailbox: Array<{ message: T; sender?: ActorRef; resolve?: (value: any) => void }> = [];
  private processing = false;
  protected system!: ActorSystem;
  protected selfName!: string;
  protected currentSender?: ActorRef;

  setSystem(system: ActorSystem, name: string) {
    this.system = system;
    this.selfName = name;
  }

  // Tell: 응답 없이 메시지 전송
  send(message: T, sender?: ActorRef): void {
    this.mailbox.push({ message, sender });
    this.processNext();
  }

  // Ask: 응답 대기 메시지 전송
  ask<R>(message: T): Promise<R> {
    return new Promise((resolve) => {
      this.mailbox.push({ message, resolve });
      this.processNext();
    });
  }

  protected abstract receive(message: T): any | Promise<any>;

  // Forward: 원래 sender 유지하며 다른 Actor에게 전달
  protected forward(target: ActorRef, message: any): void {
    (target as any).send(message, this.currentSender);
  }

  private async processNext(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    while (this.mailbox.length > 0) {
      const { message, sender, resolve } = this.mailbox.shift()!;
      this.currentSender = sender;

      try {
        const result = await this.receive(message);
        if (resolve) {
          resolve(result);
        }
      } catch (error) {
        console.error(`[${this.selfName}] Error:`, error);
      }
    }

    this.processing = false;
  }
}

// ============================================
// 메시지 타입 정의
// ============================================

// Order 관련 메시지
type OrderMessage =
  | { type: 'CREATE_ORDER'; orderId: string; amount: number }
  | { type: 'ORDER_CREATED'; orderId: string }
  | { type: 'PAYMENT_RESULT'; orderId: string; success: boolean };

// Payment 관련 메시지
type PaymentMessage =
  | { type: 'VALIDATE_PAYMENT'; orderId: string; amount: number; replyTo: ActorRef }
  | { type: 'PROCESS_PAYMENT'; orderId: string; amount: number };

// Shipping 관련 메시지
type ShippingMessage =
  | { type: 'SHIP_ORDER'; orderId: string; address: string }
  | { type: 'SHIPPING_STATUS'; orderId: string };

// ============================================
// Actor 구현
// ============================================

// OrderActor: 주문 처리 조율
class OrderActor extends Actor<OrderMessage | PaymentMessage> {
  private orders = new Map<string, { status: string; amount: number }>();

  protected async receive(message: OrderMessage | PaymentMessage): Promise<any> {
    switch (message.type) {
      case 'CREATE_ORDER': {
        console.log(`[OrderActor] Creating order: ${message.orderId}`);
        this.orders.set(message.orderId, { status: 'pending', amount: message.amount });

        // Tell 패턴: PaymentActor에게 검증 요청 (응답 안 기다림)
        const paymentActor = this.system.getActor('payment');
        if (paymentActor) {
          paymentActor.send({
            type: 'VALIDATE_PAYMENT',
            orderId: message.orderId,
            amount: message.amount,
            replyTo: this.system.getActor('order')!,
          });
        }

        return { orderId: message.orderId, status: 'processing' };
      }

      case 'PAYMENT_RESULT': {
        console.log(`[OrderActor] Payment result for ${message.orderId}: ${message.success}`);
        const order = this.orders.get(message.orderId);
        if (order) {
          order.status = message.success ? 'paid' : 'payment_failed';

          if (message.success) {
            // Forward 패턴: ShippingActor에게 전달
            const shippingActor = this.system.getActor('shipping');
            if (shippingActor) {
              this.forward(shippingActor, {
                type: 'SHIP_ORDER',
                orderId: message.orderId,
                address: '123 Main St',
              });
            }
          }
        }
        break;
      }
    }
  }
}

// PaymentActor: 결제 처리
class PaymentActor extends Actor<PaymentMessage> {
  protected async receive(message: PaymentMessage): Promise<any> {
    switch (message.type) {
      case 'VALIDATE_PAYMENT': {
        console.log(`[PaymentActor] Validating payment for order: ${message.orderId}`);

        // 결제 처리 시뮬레이션
        await this.simulatePayment(message.amount);

        const success = Math.random() > 0.2; // 80% 성공률
        console.log(`[PaymentActor] Payment ${success ? 'approved' : 'rejected'}`);

        // Tell 패턴: 결과를 OrderActor에게 알림
        message.replyTo.send({
          type: 'PAYMENT_RESULT',
          orderId: message.orderId,
          success,
        });
        break;
      }

      case 'PROCESS_PAYMENT': {
        console.log(`[PaymentActor] Processing payment: $${message.amount}`);
        await this.simulatePayment(message.amount);
        return { success: true, transactionId: `TXN-${Date.now()}` };
      }
    }
  }

  private simulatePayment(amount: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 100));
  }
}

// ShippingActor: 배송 처리
class ShippingActor extends Actor<ShippingMessage> {
  private shipments = new Map<string, { status: string; address: string }>();

  protected async receive(message: ShippingMessage): Promise<any> {
    switch (message.type) {
      case 'SHIP_ORDER': {
        console.log(`[ShippingActor] Shipping order ${message.orderId} to ${message.address}`);
        this.shipments.set(message.orderId, { status: 'shipped', address: message.address });
        return { shipped: true };
      }

      case 'SHIPPING_STATUS': {
        const shipment = this.shipments.get(message.orderId);
        return shipment || { status: 'not_found' };
      }
    }
  }
}

// ============================================
// Broadcast 패턴 구현
// ============================================

class NotificationActor extends Actor<{ type: 'NOTIFY'; message: string }> {
  private name: string;

  constructor(name: string) {
    super();
    this.name = name;
  }

  protected receive(message: { type: 'NOTIFY'; message: string }): void {
    console.log(`[${this.name}] Received notification: ${message.message}`);
  }
}

class BroadcasterActor extends Actor<{ type: 'BROADCAST'; message: string; targets: ActorRef[] }> {
  protected receive(message: { type: 'BROADCAST'; message: string; targets: ActorRef[] }): void {
    console.log(`[Broadcaster] Broadcasting to ${message.targets.length} actors`);

    // Broadcast: 모든 타겟에게 Tell
    for (const target of message.targets) {
      target.send({ type: 'NOTIFY', message: message.message });
    }
  }
}

// ============================================
// 실행 예제
// ============================================

async function main() {
  console.log('=== Message Passing Patterns Demo ===\n');

  const system = new ActorSystem();

  // Actor 생성
  const orderActor = system.spawn('order', new OrderActor());
  const paymentActor = system.spawn('payment', new PaymentActor());
  const shippingActor = system.spawn('shipping', new ShippingActor());

  console.log('--- 1. Tell Pattern (Fire-and-Forget) ---\n');

  // Tell: 응답 없이 메시지 전송
  orderActor.send({
    type: 'CREATE_ORDER',
    orderId: 'ORD-001',
    amount: 99.99,
  });

  await delay(500);

  console.log('\n--- 2. Ask Pattern (Request-Response) ---\n');

  // Ask: 응답 대기
  const paymentResult = await paymentActor.ask<{ success: boolean; transactionId: string }>({
    type: 'PROCESS_PAYMENT',
    orderId: 'ORD-002',
    amount: 150.0,
  });

  console.log('Payment result:', paymentResult);

  console.log('\n--- 3. Broadcast Pattern ---\n');

  // Broadcast 설정
  const notifier1 = system.spawn('notifier1', new NotificationActor('Notifier-1'));
  const notifier2 = system.spawn('notifier2', new NotificationActor('Notifier-2'));
  const notifier3 = system.spawn('notifier3', new NotificationActor('Notifier-3'));
  const broadcaster = system.spawn('broadcaster', new BroadcasterActor());

  broadcaster.send({
    type: 'BROADCAST',
    message: 'System maintenance in 5 minutes',
    targets: [notifier1, notifier2, notifier3],
  });

  await delay(200);

  console.log('\n=== Demo Complete ===');
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch(console.error);
