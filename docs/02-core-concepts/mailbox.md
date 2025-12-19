# Mailbox

> Actor의 메시지 수신함인 Mailbox의 동작 원리와 구현을 알아봅니다.

## Mailbox란?

Mailbox는 Actor가 받은 메시지를 저장하는 **큐(Queue)**입니다. Actor는 Mailbox에서 메시지를 하나씩 꺼내 순차적으로 처리합니다.

```
┌─────────────────────────────────────────────────────────────┐
│                       Mailbox 구조                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  외부에서 메시지 도착                                        │
│         │                                                   │
│         ▼                                                   │
│  ┌──────────────────────────────────────┐                  │
│  │         Mailbox (Queue)              │                  │
│  │  ┌─────┬─────┬─────┬─────┬─────┐    │                  │
│  │  │ M1  │ M2  │ M3  │ M4  │     │ ◀── Enqueue          │
│  │  └─────┴─────┴─────┴─────┴─────┘    │                  │
│  │    │                                 │                  │
│  │    │ Dequeue                         │                  │
│  │    ▼                                 │                  │
│  └──────────────────────────────────────┘                  │
│         │                                                   │
│         ▼                                                   │
│  ┌──────────────────────────────────────┐                  │
│  │            Actor 처리                 │                  │
│  │     receive(M1) → 상태 변경          │                  │
│  │     (M2, M3, M4는 대기)              │                  │
│  └──────────────────────────────────────┘                  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Mailbox의 핵심 특성

### 1. 순차 처리 (Sequential Processing)

```
시간 →
─────────────────────────────────────────────────────
메시지 도착:  M1    M2    M3    M4    M5
                ↓     ↓     ↓     ↓     ↓
Mailbox:    [M1] [M1,M2] [M2,M3] [M3,M4] [M4,M5]
                    ↓       ↓       ↓       ↓
처리:        M1 처리  M2 처리  M3 처리  M4 처리

핵심: 한 번에 하나만 처리 → 스레드 안전!
```

### 2. FIFO (First-In-First-Out)

```
입력 순서:  M1 → M2 → M3 → M4
처리 순서:  M1 → M2 → M3 → M4  (동일)
```

### 3. Lock-Free 구현

대부분의 Actor 프레임워크는 Lock-Free 큐를 사용:

```cpp
// 개념적인 Lock-Free 큐 (MPSC: Multi-Producer Single-Consumer)
template<typename T>
class LockFreeQueue {
    std::atomic<Node*> head;
    std::atomic<Node*> tail;

public:
    void enqueue(T item) {
        // CAS(Compare-And-Swap) 사용
        // 여러 스레드가 동시에 추가 가능
    }

    T dequeue() {
        // 단일 소비자 (Actor) 만 호출
        // Lock 불필요
    }
};
```

---

## Mailbox 종류

### 1. Unbounded Mailbox (기본)

```
┌─────────────────────────────────────────┐
│ Unbounded Mailbox                       │
├─────────────────────────────────────────┤
│ • 크기 제한 없음                         │
│ • 메모리가 허용하는 한 계속 쌓임          │
│ • 메시지 유실 없음                       │
│ • ⚠️ 메모리 고갈 위험                   │
└─────────────────────────────────────────┘

[M1][M2][M3][M4][M5]...[M1000000] → 💥 OutOfMemory
```

### 2. Bounded Mailbox

```
┌─────────────────────────────────────────┐
│ Bounded Mailbox                         │
├─────────────────────────────────────────┤
│ • 최대 크기 지정                         │
│ • 초과 시 정책에 따라 동작               │
│ • 메모리 사용량 예측 가능                │
└─────────────────────────────────────────┘

최대 크기: 100
[M1][M2]...[M100] → 가득 참 → 정책 적용
```

**오버플로우 정책:**

| 정책 | 설명 |
|------|------|
| Block | 공간이 생길 때까지 전송자 블로킹 |
| Drop Head | 가장 오래된 메시지 버림 |
| Drop Tail | 새 메시지 버림 |
| Drop New | 새 메시지 버림 (Drop Tail과 동일) |
| Fail | 예외 발생 |

```scala
// Akka 설정
bounded-mailbox {
  mailbox-type = "akka.dispatch.BoundedMailbox"
  mailbox-capacity = 1000
  mailbox-push-timeout-time = 10s
}
```

### 3. Priority Mailbox

```
┌─────────────────────────────────────────┐
│ Priority Mailbox                        │
├─────────────────────────────────────────┤
│ • 메시지 우선순위에 따라 처리            │
│ • 중요한 메시지 먼저 처리                │
│ • FIFO 순서 깨짐                        │
└─────────────────────────────────────────┘

도착 순서:   [Low][Low][High][Low][Critical]
처리 순서:   Critical → High → Low → Low → Low
```

```scala
// Akka Priority Mailbox
class MyPriorityMailbox(settings: Settings, cfg: Config)
  extends UnboundedStablePriorityMailbox(
    PriorityGenerator {
      case Critical(_) => 0  // 최우선
      case High(_)     => 1
      case Low(_)      => 2
      case _           => 3
    }
  )
```

### 4. Control-Aware Mailbox

시스템 메시지를 우선 처리:

```
┌─────────────────────────────────────────┐
│ Control-Aware Mailbox                   │
├─────────────────────────────────────────┤
│ 시스템 메시지 (Kill, Stop 등) 우선       │
│ 일반 메시지는 이후 처리                  │
└─────────────────────────────────────────┘

[User][User][Kill][User]
         ↓
Kill을 먼저 처리 → Actor 종료
```

---

## Mailbox 구현 상세

### MPSC (Multi-Producer Single-Consumer) 큐

Actor Mailbox의 전형적인 구현:

```cpp
// 여러 스레드(Producer)가 동시에 메시지 추가
// 하나의 Actor(Consumer)만 메시지 소비

class MPSCQueue {
    struct Node {
        std::atomic<Node*> next{nullptr};
        Message msg;
    };

    std::atomic<Node*> head;  // Producer들이 경쟁
    Node* tail;               // Consumer만 접근

public:
    void push(Message msg) {
        auto node = new Node{nullptr, msg};
        auto prev = head.exchange(node);
        prev->next.store(node);
    }

    Message pop() {
        auto next = tail->next.load();
        if (next) {
            tail = next;
            return next->msg;
        }
        return {};
    }
};
```

### 스케줄링과 Mailbox

```
┌─────────────────────────────────────────────────────────────┐
│                    Actor 스케줄링                           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Thread Pool                                                │
│  ┌─────────────────────────────────────────┐               │
│  │ Thread 1  │ Thread 2  │ Thread 3  │ ... │               │
│  └─────────────────────────────────────────┘               │
│       │            │            │                          │
│       ▼            ▼            ▼                          │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐                    │
│  │ Actor A │  │ Actor C │  │ Actor E │ ← 현재 실행 중      │
│  │[Mailbox]│  │[Mailbox]│  │[Mailbox]│                    │
│  └─────────┘  └─────────┘  └─────────┘                    │
│                                                             │
│  대기 중인 Actor들 (Mailbox에 메시지 있음)                   │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐                    │
│  │ Actor B │  │ Actor D │  │ Actor F │                    │
│  │ [M1,M2] │  │ [M3]    │  │ [M4,M5] │                    │
│  └─────────┘  └─────────┘  └─────────┘                    │
│                                                             │
│  Actor A 처리 완료 → Actor B 스케줄링                       │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Mailbox 모니터링

### 메트릭

```scala
// Akka Mailbox 메트릭
actor.mailbox.numberOfMessages  // 현재 대기 메시지 수
actor.mailbox.hasMessages       // 메시지 있는지 여부
```

### 경고 설정

```yaml
# application.conf
akka.actor.default-mailbox {
  mailbox-type = "akka.dispatch.BoundedMailbox"
  mailbox-capacity = 1000

  # 경고 임계값
  stash-capacity = 100
}
```

---

## 문제 상황과 해결

### 1. Mailbox Overflow

```
문제: 메시지 생산 > 소비 → 메모리 고갈

해결책:
1. Bounded Mailbox 사용
2. 백프레셔 구현
3. 처리 속도 개선 (Worker Pool)
```

### 2. 메시지 지연

```
문제: 높은 우선순위 메시지가 뒤에 쌓임

해결책:
1. Priority Mailbox 사용
2. 별도 Actor로 분리
3. 시스템 메시지 채널 분리
```

### 3. 순서 의존성 문제

```
문제: M1 처리 후 M2 처리해야 하는데 보장 안됨
      (다른 Actor에서 보낸 경우)

해결책:
1. 동일 Actor에서 순차 전송
2. Correlation ID로 순서 추적
3. Saga 패턴 적용
```

---

## 참고 자료

- [Akka Mailboxes](https://doc.akka.io/docs/akka/current/typed/mailboxes.html)
- [Lock-Free Programming](https://preshing.com/20120612/an-introduction-to-lock-free-programming/)
- [MPSC Queue Design](https://www.1024cores.net/home/lock-free-algorithms/queues/non-intrusive-mpsc-node-based-queue)
