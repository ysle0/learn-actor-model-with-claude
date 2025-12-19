# 03. Actor vs Threads - 스레드 모델과의 비교

> 전통적인 스레드 기반 동시성과 Actor Model의 차이를 상세히 비교합니다.

## 한눈에 보는 비교

```
┌─────────────────────────────────────────────────────────────────┐
│               Thread vs Actor 비교                              │
├────────────────────┬────────────────────────────────────────────┤
│    항목            │    Thread Model    │    Actor Model        │
├────────────────────┼────────────────────┼───────────────────────┤
│ 통신 방식          │ 공유 메모리        │ 메시지 패싱           │
│ 동기화             │ Lock/Mutex 필요    │ Lock 불필요           │
│ 메모리 사용        │ ~1-8MB/스레드      │ ~300B-수KB/Actor      │
│ 생성 개수          │ 수천 개            │ 수백만 개             │
│ 컨텍스트 스위칭    │ OS 레벨 (비쌈)     │ 런타임 레벨 (저렴)    │
│ 장애 격리          │ 전체 프로세스      │ 개별 Actor            │
│ 분산 환경          │ 수동 구현          │ 내장 지원             │
│ 디버깅             │ 매우 어려움        │ 상대적으로 쉬움       │
└────────────────────┴────────────────────┴───────────────────────┘
```

---

## 문제 영역별 비교

### 1. Race Condition

#### Thread Model

```cpp
// ❌ Thread: Race Condition 발생 가능
class Counter {
    int value = 0;

public:
    void increment() {
        // read-modify-write: 원자적이지 않음!
        value++;  // 💥 Race Condition
    }
};

// 스레드 1: value 읽음 (0)
// 스레드 2: value 읽음 (0)
// 스레드 1: value + 1 씀 (1)
// 스레드 2: value + 1 씀 (1)  ← 잘못된 결과!
```

```cpp
// 해결: Lock 추가
class SafeCounter {
    int value = 0;
    std::mutex mtx;

public:
    void increment() {
        std::lock_guard<std::mutex> lock(mtx);
        value++;  // 안전하지만 성능 저하
    }
};
```

#### Actor Model

```cpp
// ✅ Actor: Race Condition 불가능
class CounterActor : public Actor {
    int value = 0;

    void receive(Message msg) {
        // 한 번에 하나의 메시지만 처리
        // Lock 없이도 안전!
        value++;
    }
};
```

### 2. Deadlock

#### Thread Model

```cpp
// ❌ Thread: Deadlock 위험
void transfer(Account& from, Account& to, int amount) {
    std::lock_guard<std::mutex> lock1(from.mutex);
    std::lock_guard<std::mutex> lock2(to.mutex);
    // ...
}

// Thread 1: transfer(A, B, 100)
//   A.lock() 획득 → B.lock() 대기
// Thread 2: transfer(B, A, 50)
//   B.lock() 획득 → A.lock() 대기
// 💀 Deadlock!
```

#### Actor Model

```cpp
// ✅ Actor: Deadlock 없음
class AccountActor : public Actor {
    int balance;

    void receive(Message msg) {
        if (msg.type == "withdraw") {
            balance -= msg.amount;
            target.send("deposit", msg.amount);
        }
    }
};
// Lock이 없으므로 Deadlock 불가능
// (단, 상호 대기 메시지는 여전히 주의 필요)
```

---

## 성능 비교

### 메모리 사용량

```
┌─────────────────────────────────────────────────────────────┐
│                    메모리 사용량 비교                        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  OS Thread                                                  │
│  ──────────────────────────────────────────                 │
│  • 스택 크기: 1-8 MB (기본값)                                │
│  • 커널 자원: TID, 스케줄링 구조체                           │
│  • 1000 스레드 = 1-8 GB 메모리                               │
│                                                             │
│  Actor (Erlang 프로세스 기준)                                │
│  ──────────────────────────────────────────                 │
│  • 초기 힙: 233 words (~2KB)                                │
│  • 스택: 필요에 따라 증가                                    │
│  • 1,000,000 Actor = ~2-3 GB 메모리                         │
│                                                             │
│  결론: Actor가 ~1000배 더 효율적                             │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 처리량 (Throughput)

```
┌─────────────────────────────────────────────────────────────┐
│                    벤치마크 비교 (예시)                      │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  시나리오: 100만 개의 독립 작업 처리                         │
│                                                             │
│  Thread Pool (100 스레드)                                   │
│  ────────────────────────                                   │
│  • 처리 시간: 10초                                          │
│  • CPU 사용률: 60% (Lock 경합)                              │
│  • 메모리: 800MB                                            │
│                                                             │
│  Actor System (100만 Actor)                                 │
│  ────────────────────────                                   │
│  • 처리 시간: 3초                                           │
│  • CPU 사용률: 95%                                          │
│  • 메모리: 3GB                                              │
│                                                             │
│  ※ 실제 수치는 워크로드에 따라 다름                          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 컨텍스트 스위칭

```
OS Thread Context Switch
────────────────────────
1. 레지스터 저장 (수십 개)
2. 스택 포인터 저장
3. 페이지 테이블 업데이트
4. TLB 플러시 (가능성)
5. 캐시 미스 증가
→ 약 1-10 마이크로초

Actor Context Switch
────────────────────
1. 현재 Actor 상태 저장 (작은 구조체)
2. 다음 Actor 선택
3. 상태 복원
→ 약 100 나노초 이하
```

---

## 코드 복잡도 비교

### 예제: 채팅방 구현

#### Thread 기반

```cpp
class ChatRoom {
    std::vector<User*> users;
    std::mutex users_mutex;
    std::map<int, std::vector<Message>> messages;
    std::mutex messages_mutex;

public:
    void join(User* user) {
        std::lock_guard<std::mutex> lock(users_mutex);
        users.push_back(user);
    }

    void sendMessage(int userId, const Message& msg) {
        std::lock_guard<std::mutex> lock1(users_mutex);
        std::lock_guard<std::mutex> lock2(messages_mutex);

        // Lock 순서 주의! Deadlock 위험
        for (auto& user : users) {
            if (user->id != userId) {
                user->receive(msg);  // 또 다른 Lock?
            }
        }
        messages[userId].push_back(msg);
    }

    void leave(User* user) {
        std::lock_guard<std::mutex> lock(users_mutex);
        // 복잡한 동기화 로직...
    }
};
```

#### Actor 기반

```cpp
class ChatRoomActor : public Actor {
    std::set<ActorRef> users;
    std::vector<Message> history;

    void receive(Msg msg) {
        match(msg,
            [&](Join join) {
                users.insert(join.user);
                join.user.send(Welcome{history});
            },
            [&](SendMessage sm) {
                history.push_back(sm.message);
                for (auto& user : users) {
                    user.send(NewMessage{sm.message});
                }
            },
            [&](Leave leave) {
                users.erase(leave.user);
            }
        );
    }
};
```

---

## 장애 처리 비교

### Thread Model

```cpp
void worker() {
    try {
        // 작업 수행
        riskyOperation();
    } catch (const std::exception& e) {
        // 에러 처리... 하지만
        // 공유 상태는 어떤 상태?
        // 다른 스레드에 영향?
        log(e.what());
    }
}

// 처리되지 않은 예외 → 전체 프로세스 크래시
```

### Actor Model

```
┌─────────────────────────────────────────────────────────────┐
│                  Actor 장애 처리                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│                     Supervisor                              │
│                         │                                   │
│           ┌─────────────┼─────────────┐                    │
│           │             │             │                    │
│           ▼             ▼             ▼                    │
│      ┌─────────┐   ┌─────────┐   ┌─────────┐              │
│      │ Worker1 │   │ Worker2 │   │ Worker3 │              │
│      └─────────┘   └────┬────┘   └─────────┘              │
│                         │                                   │
│                       💥 Crash                              │
│                         │                                   │
│                         ▼                                   │
│                  Supervisor 통지                            │
│                         │                                   │
│                         ▼                                   │
│                  재시작/무시/중단                            │
│                                                             │
│  → 다른 Worker들은 영향 없음!                               │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 언제 무엇을 선택할까?

### Thread Model 선택

```
✅ 적합한 경우:
• CPU 집약적 계산 (행렬 연산, 이미지 처리)
• 공유 데이터 구조가 꼭 필요한 경우
• 기존 코드베이스가 Thread 기반
• 팀이 Thread 프로그래밍에 익숙

❌ 부적합한 경우:
• 높은 동시성 (수만 이상)
• 분산 시스템
• 장애 허용 필수
```

### Actor Model 선택

```
✅ 적합한 경우:
• 많은 독립적 엔티티 (사용자, 세션, 디바이스)
• 분산/클러스터 환경
• 장애 격리 필요
• 실시간 상호작용

❌ 부적합한 경우:
• 단순한 동기 처리
• 강한 트랜잭션 요구
• 순수 계산 작업
```

---

## 심화 문서

| 주제 | 설명 | 링크 |
|------|------|------|
| Thread 문제점 | Race, Deadlock 상세 | [thread-problems.md](./thread-problems.md) |
| Lock-Free 원리 | CAS, Memory Ordering | [lock-free.md](./lock-free.md) |
| 성능 벤치마크 | 상세 성능 비교 | [performance-comparison.md](./performance-comparison.md) |
| 선택 가이드 | 상황별 선택 기준 | [when-to-use.md](./when-to-use.md) |

---

## 다음 단계

- [04. Supervision](../04-supervision/README.md) - 장애 복구와 감독 트리
- [05. Frameworks](../05-frameworks/README.md) - 프레임워크별 구현 비교
