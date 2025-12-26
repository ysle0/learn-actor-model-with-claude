# Lock-Free 동시성

> Actor Model이 Lock 없이 동시성을 달성하는 방법

## 개요

Actor Model은 전통적인 Lock 기반 동기화 대신 **메시지 패싱**을 사용하여 동시성 문제를 해결합니다.

```
┌─────────────────────────────────────────────────────────────────┐
│              Lock-Based vs Lock-Free                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   Lock-Based (Traditional):                                      │
│   ┌────────┐      Lock      ┌────────────┐                      │
│   │Thread 1│ ──── 획득 ────▶│            │                      │
│   │Thread 2│ ──── 대기 ────▶│  Critical  │                      │
│   │Thread 3│ ──── 대기 ────▶│  Section   │                      │
│   └────────┘                └────────────┘                      │
│                                                                  │
│   Lock-Free (Actor Model):                                       │
│   ┌────────┐    Message    ┌────────────┐                       │
│   │Actor 1 │ ─────────────▶│            │                       │
│   │Actor 2 │ ─────────────▶│  Mailbox   │ ──▶ 순차 처리        │
│   │Actor 3 │ ─────────────▶│  (Queue)   │                       │
│   └────────┘               └────────────┘                       │
│                                                                  │
│   대기 없음! 메시지만 보내고 즉시 반환                           │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Lock-Free의 의미

### Lock을 사용하지 않는다

```
Actor Model에서는:
• synchronized 키워드 불필요
• Mutex/Semaphore 불필요
• ReentrantLock 불필요
• Critical Section 개념 없음
```

### 왜 Lock이 필요 없는가?

```
┌─────────────────────────────────────────────────────────────────┐
│               Why No Locks Needed                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   1. 상태 격리 (State Isolation)                                 │
│      ┌─────────┐     ┌─────────┐     ┌─────────┐               │
│      │ Actor A │     │ Actor B │     │ Actor C │               │
│      │ [state] │     │ [state] │     │ [state] │               │
│      └─────────┘     └─────────┘     └─────────┘               │
│                                                                  │
│      각 Actor는 자신만의 상태를 가짐                            │
│      다른 Actor의 상태에 접근 불가                              │
│                                                                  │
│   2. 순차적 메시지 처리                                          │
│      ┌─────────────────────────────────────────┐                │
│      │  Mailbox: [msg1][msg2][msg3]            │                │
│      │                  │                      │                │
│      │                  ▼                      │                │
│      │           한 번에 하나씩 처리           │                │
│      └─────────────────────────────────────────┘                │
│                                                                  │
│      동시에 여러 메시지를 처리하지 않음                         │
│      → Race Condition 원천 차단                                 │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## 동시성 달성 방법

### 여러 Actor 병렬 실행

```
┌─────────────────────────────────────────────────────────────────┐
│                  Concurrent Actors                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   CPU Core 1          CPU Core 2          CPU Core 3            │
│   ┌─────────┐        ┌─────────┐        ┌─────────┐            │
│   │ Actor A │        │ Actor B │        │ Actor C │            │
│   │ 처리 중 │        │ 처리 중 │        │ 처리 중 │            │
│   └─────────┘        └─────────┘        └─────────┘            │
│                                                                  │
│   각 Actor는 독립적으로 병렬 실행                                │
│   서로의 상태에 간섭하지 않음                                    │
│   → Lock 없이 진정한 병렬성 달성                                │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Mailbox의 역할

```java
// 개념적 Mailbox 구현
class Mailbox {
    private final ConcurrentLinkedQueue<Message> queue =
        new ConcurrentLinkedQueue<>();

    // 여러 스레드에서 동시에 호출 가능 (non-blocking)
    public void enqueue(Message msg) {
        queue.offer(msg);  // Lock-free 연산
    }

    // Actor의 실행 스레드에서만 호출
    public Message dequeue() {
        return queue.poll();  // Lock-free 연산
    }
}
```

## Lock-Free 자료구조

### MPSC Queue (Multiple Producer, Single Consumer)

```
┌─────────────────────────────────────────────────────────────────┐
│                     MPSC Queue                                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   Producer 1 ──┐                                                │
│   Producer 2 ──┼──▶ [Queue] ──▶ Single Consumer (Actor)        │
│   Producer 3 ──┘                                                │
│                                                                  │
│   • 여러 생산자가 동시에 enqueue                                │
│   • 단일 소비자만 dequeue                                       │
│   • Compare-And-Swap (CAS) 연산으로 Lock-free 구현              │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### CAS (Compare-And-Swap) 연산

```java
// CAS 기반 Lock-free 증가
public class LockFreeCounter {
    private AtomicInteger count = new AtomicInteger(0);

    public void increment() {
        int current, next;
        do {
            current = count.get();
            next = current + 1;
        } while (!count.compareAndSet(current, next));
        // 실패하면 재시도 (다른 스레드가 수정한 경우)
    }
}
```

```
CAS 동작 원리:
┌─────────────────────────────────────────────────────────────────┐
│  compareAndSet(expected, newValue)                               │
│                                                                  │
│  if (현재값 == expected) {                                       │
│      현재값 = newValue;  // 원자적 수행                         │
│      return true;                                                │
│  } else {                                                        │
│      return false;  // 다른 스레드가 수정함                     │
│  }                                                               │
└─────────────────────────────────────────────────────────────────┘
```

## Actor에서의 상태 변경

### Lock 기반 vs Actor 기반

```java
// Lock 기반 (전통적)
public class BankAccountTraditional {
    private final Object lock = new Object();
    private double balance;

    public void deposit(double amount) {
        synchronized(lock) {
            balance += amount;
        }
    }

    public void withdraw(double amount) {
        synchronized(lock) {
            if (balance >= amount) {
                balance -= amount;
            }
        }
    }
}
```

```typescript
// Actor 기반 (Lock 불필요)
class BankAccountActor extends Actor<BankMessage> {
    private balance: number = 0;

    protected receive(message: BankMessage): void {
        switch (message.type) {
            case 'DEPOSIT':
                this.balance += message.amount;
                break;

            case 'WITHDRAW':
                if (this.balance >= message.amount) {
                    this.balance -= message.amount;
                }
                break;
        }
        // Lock 없이도 안전!
        // receive는 항상 단일 스레드에서 순차 실행
    }
}
```

## 성능 이점

```
┌─────────────────────────────────────────────────────────────────┐
│              Lock-Free Performance Benefits                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   Lock-Based:                                                    │
│   Thread 1: [작업][==대기==][작업][===대기===][작업]            │
│   Thread 2: [대기][작업][==대기==][작업][대기][작업]            │
│                                                                  │
│   많은 시간을 Lock 대기에 소비                                   │
│                                                                  │
│   Lock-Free Actors:                                              │
│   Actor 1: [처리][처리][처리][처리][처리][처리]                 │
│   Actor 2: [처리][처리][처리][처리][처리][처리]                 │
│                                                                  │
│   대기 없이 지속적으로 작업 수행                                 │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 수치 비교

| 항목 | Lock-Based | Actor Model |
|------|------------|-------------|
| Lock 획득 시간 | 수십-수백 나노초 | 0 |
| Lock Contention | 스레드 증가 시 악화 | 없음 |
| Context Switch | 빈번 | 최소화 |
| 확장성 | 제한적 | 선형적 |

## 주의사항

### 1. Mailbox는 Lock-Free여야 함

```
대부분의 Actor 프레임워크는 내부적으로 Lock-free Queue 사용:
• Akka: MPSC (Multiple Producer Single Consumer) queue
• Orleans: ConcurrentQueue + activation 관리
• Erlang: VM 레벨에서 최적화된 메시지 큐
```

### 2. 외부 자원 접근 시

```typescript
class DatabaseActor extends Actor<DbMessage> {
    protected async receive(message: DbMessage): void {
        // 외부 DB 접근 시에는 별도 고려 필요
        // Actor 내부 상태는 Lock-free
        // 하지만 DB 자체는 Lock 사용할 수 있음

        const result = await this.db.query(message.sql);
        // ...
    }
}
```

### 3. 블로킹 연산 피하기

```scala
// 나쁜 예: Actor 내에서 블로킹
def receive: Receive = {
  case Request(url) =>
    val result = Http.get(url).execute()  // 블로킹!
    sender() ! result
}

// 좋은 예: 비동기 처리
def receive: Receive = {
  case Request(url) =>
    val replyTo = sender()
    Http.get(url).executeAsync().foreach { result =>
      replyTo ! result
    }
}
```

## 관련 문서

- [스레드 문제점](./thread-problems.md)
- [성능 비교](./performance-comparison.md)
- [Mailbox 동작 원리](../02-core-concepts/mailbox.md)
