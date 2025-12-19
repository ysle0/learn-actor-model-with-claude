/**
 * Basic Actor Pattern - Counter Actor in TypeScript
 *
 * 이 예제는 Actor Model의 기본 개념을 직접 구현합니다.
 * 프로덕션에서는 전용 라이브러리 사용을 권장합니다.
 */

// ============================================
// Message Types (메시지 타입 정의)
// ============================================

type Message =
  | { type: 'INCREMENT' }
  | { type: 'DECREMENT' }
  | { type: 'GET_COUNT'; replyTo: (count: number) => void }
  | { type: 'RESET' };

// ============================================
// Actor Base Class (Actor 기본 클래스)
// ============================================

abstract class Actor<T> {
  private mailbox: T[] = [];
  private processing = false;

  // 메시지 전송 (비동기, 블로킹 없음)
  send(message: T): void {
    this.mailbox.push(message);
    this.processNext();
  }

  // 메시지 처리 (서브클래스에서 구현)
  protected abstract receive(message: T): void | Promise<void>;

  // Mailbox에서 메시지를 하나씩 처리
  private async processNext(): Promise<void> {
    if (this.processing) return;

    this.processing = true;

    while (this.mailbox.length > 0) {
      const message = this.mailbox.shift()!;
      try {
        await this.receive(message);
      } catch (error) {
        console.error('Error processing message:', error);
        // Actor 모델에서는 에러 시 Supervisor에게 알림
        // 여기서는 단순히 로그만 출력
      }
    }

    this.processing = false;
  }
}

// ============================================
// Counter Actor (카운터 액터 구현)
// ============================================

class CounterActor extends Actor<Message> {
  // 캡슐화된 상태 - 외부에서 직접 접근 불가
  private count: number = 0;

  protected receive(message: Message): void {
    switch (message.type) {
      case 'INCREMENT':
        this.count++;
        console.log(`Incremented: ${this.count}`);
        break;

      case 'DECREMENT':
        this.count--;
        console.log(`Decremented: ${this.count}`);
        break;

      case 'GET_COUNT':
        // 응답을 콜백으로 전달 (Ask 패턴)
        message.replyTo(this.count);
        break;

      case 'RESET':
        this.count = 0;
        console.log('Reset to 0');
        break;
    }
  }
}

// ============================================
// 사용 예제
// ============================================

async function main() {
  console.log('=== Counter Actor Example ===\n');

  const counter = new CounterActor();

  // Tell 패턴: 응답 없이 메시지 전송
  counter.send({ type: 'INCREMENT' });
  counter.send({ type: 'INCREMENT' });
  counter.send({ type: 'INCREMENT' });
  counter.send({ type: 'DECREMENT' });

  // Ask 패턴: 응답 대기
  const getCount = (): Promise<number> => {
    return new Promise((resolve) => {
      counter.send({ type: 'GET_COUNT', replyTo: resolve });
    });
  };

  // 비동기로 결과 확인
  await new Promise(resolve => setTimeout(resolve, 100));

  const count = await getCount();
  console.log(`\nFinal count: ${count}`);

  // Reset
  counter.send({ type: 'RESET' });

  await new Promise(resolve => setTimeout(resolve, 100));

  const resetCount = await getCount();
  console.log(`After reset: ${resetCount}`);
}

main().catch(console.error);

// ============================================
// 스레드 안전성 데모
// ============================================

async function concurrencyDemo() {
  console.log('\n=== Concurrency Demo ===\n');

  const counter = new CounterActor();

  // 동시에 1000개의 INCREMENT 메시지 전송
  const promises: Promise<void>[] = [];

  for (let i = 0; i < 1000; i++) {
    promises.push(
      new Promise((resolve) => {
        counter.send({ type: 'INCREMENT' });
        resolve();
      })
    );
  }

  await Promise.all(promises);

  // 잠시 대기 후 결과 확인
  await new Promise(resolve => setTimeout(resolve, 500));

  const getCount = (): Promise<number> => {
    return new Promise((resolve) => {
      counter.send({ type: 'GET_COUNT', replyTo: resolve });
    });
  };

  const finalCount = await getCount();
  console.log(`Expected: 1000, Actual: ${finalCount}`);
  console.log(`Thread-safe: ${finalCount === 1000 ? '✅ YES' : '❌ NO'}`);
}

// concurrencyDemo().catch(console.error);
