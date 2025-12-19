# 왜 Actor Model인가?

> 동시성 프로그래밍의 다양한 접근 방식 중 Actor Model이 제공하는 고유한 가치를 알아봅니다.

## 동시성 프로그래밍의 어려움

### 근본적인 문제

```
단일 스레드 세계                    다중 스레드 세계
──────────────────────────────────────────────────────
예측 가능                          비결정적
순차 실행                          병렬 실행
상태 추적 쉬움                     상태 폭발
디버깅 간단                        Heisenbug
```

> **Heisenbug**: 관찰하려고 하면 사라지는 버그. 디버거를 붙이면 타이밍이 바뀌어 재현 불가.

### 공유 메모리 + Lock의 문제

```cpp
// 전형적인 멀티스레드 코드
class BankAccount {
    double balance;
    std::mutex mtx;

public:
    void transfer(BankAccount& to, double amount) {
        // Deadlock 위험!
        std::lock_guard<std::mutex> lock1(this->mtx);
        std::lock_guard<std::mutex> lock2(to.mtx);

        if (balance >= amount) {
            balance -= amount;
            to.balance += amount;
        }
    }
};
```

**발생 가능한 문제들:**

| 문제 | 설명 | 결과 |
|------|------|------|
| **Race Condition** | 여러 스레드가 동시에 데이터 수정 | 데이터 손상 |
| **Deadlock** | 상호 Lock 대기 | 시스템 멈춤 |
| **Livelock** | 서로 양보만 반복 | 진전 없음 |
| **Priority Inversion** | 낮은 우선순위가 높은 것을 블록 | 성능 저하 |
| **Lock Contention** | Lock 경쟁 과열 | 병렬성 상실 |

---

## 다른 동시성 모델과의 비교

### 1. 공유 메모리 + Lock

```cpp
// 전통적 접근
std::mutex mtx;
int shared_counter = 0;

void increment() {
    std::lock_guard<std::mutex> lock(mtx);
    shared_counter++;
}
```

**장단점:**
- ✅ 직관적 (기존 사고방식과 유사)
- ✅ 성능 최적화 가능
- ❌ 복잡도 폭발 (Lock 수 증가)
- ❌ 버그 발견 어려움

### 2. Software Transactional Memory (STM)

```haskell
-- Haskell STM
transfer :: Account -> Account -> Int -> STM ()
transfer from to amount = do
    fromBal <- readTVar from
    toBal <- readTVar to
    writeTVar from (fromBal - amount)
    writeTVar to (toBal + amount)
```

**장단점:**
- ✅ 합성 가능 (composable)
- ✅ Deadlock 없음
- ❌ 충돌 시 재시도 오버헤드
- ❌ I/O 작업과 함께 사용 어려움

### 3. CSP (Communicating Sequential Processes)

```go
// Go channels
func counter(ch chan int) {
    count := 0
    for {
        select {
        case <-ch:
            count++
        }
    }
}
```

**장단점:**
- ✅ 동기적 통신 모델
- ✅ 언어 레벨 지원 (Go)
- ❌ 채널 닫힘 처리 복잡
- ❌ 분산 환경 확장 어려움

### 4. Actor Model

```scala
// Akka Actor
class Counter extends Actor {
  var count = 0
  def receive = {
    case Increment => count += 1
    case GetCount  => sender() ! count
  }
}
```

**장단점:**
- ✅ Lock 없음
- ✅ 분산 환경 자연스러운 확장
- ✅ 장애 격리
- ❌ 메시지 순서 관리 필요
- ❌ 디버깅 도구 학습 필요

---

## Actor Model의 고유한 강점

### 1. 진정한 캡슐화

```
OOP의 캡슐화                        Actor의 캡슐화
──────────────────────────────────────────────────────
private 필드                        완전히 격리된 상태
메서드 호출로 접근                   메시지로만 접근
동시 접근 가능                       순차 처리 보장
Lock 필요                           Lock 불필요
```

```cpp
// OOP: private이지만 동시 접근 가능
class Counter {
    private int value;  // 여러 스레드가 동시에 접근 가능

    public synchronized void increment() {
        value++;  // Lock 필요
    }
};

// Actor: 진정한 격리
class CounterActor : Actor {
    int value;  // 오직 이 Actor만 접근

    void receive(Message msg) {
        value++;  // Lock 불필요, 순차 처리 보장
    }
};
```

### 2. 위치 투명성 (Location Transparency)

```
┌─────────────────────────────────────────────────────────────┐
│                    위치 투명성                               │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  로컬 Actor                                                 │
│  ┌─────────┐     메시지     ┌─────────┐                    │
│  │ Actor A │ ────────────▶ │ Actor B │    같은 프로세스    │
│  └─────────┘               └─────────┘                     │
│                                                             │
│  원격 Actor (동일한 코드!)                                   │
│  ┌─────────┐     메시지     ┌─────────┐                    │
│  │ Actor A │ ────────────▶ │ Actor B │    다른 서버       │
│  └─────────┘     네트워크   └─────────┘                     │
│                                                             │
│  → 코드 변경 없이 분산 시스템 구축 가능                       │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 3. 장애 격리 (Fault Isolation)

```
전통적 방식                         Actor 방식
──────────────────────────────────────────────────────
하나의 예외 → 전체 크래시            하나의 Actor 실패 → 해당 Actor만 영향
방어적 코딩 필수                     "Let it Crash" 철학
복잡한 에러 핸들링                   Supervisor가 자동 복구
```

```erlang
%% Erlang: Supervisor 설정
{ok, {{one_for_one, 5, 60},  %% 60초에 5번까지 재시작
      [{worker, {my_worker, start_link, []},
        permanent, 5000, worker, [my_worker]}]}}.
```

### 4. 확장성 (Scalability)

```
스레드 기반                         Actor 기반
──────────────────────────────────────────────────────
1 스레드 ≈ 1-8 MB 메모리            1 Actor ≈ 300 바이트 ~ 수 KB
수천 개가 한계                      수백만 개 가능
OS 스케줄링                         VM/런타임 스케줄링
컨텍스트 스위칭 비용 높음            경량 스위칭
```

---

## 언제 Actor Model을 선택해야 하는가?

### ✅ Actor Model이 적합한 경우

```
1. 높은 동시성 요구
   ────────────────
   • 수천~수백만 동시 연결
   • 채팅 서버, 게임 서버
   • IoT 디바이스 관리

2. 분산 시스템
   ───────────
   • 여러 노드 간 상태 공유
   • 마이크로서비스 통신
   • 지리적으로 분산된 서비스

3. 장애 허용 필수
   ────────────
   • 24/7 서비스
   • 부분 장애 시에도 동작 필요
   • 자동 복구 요구

4. 상태가 있는 엔티티
   ─────────────────
   • 사용자 세션
   • 게임 캐릭터
   • 디바이스 상태
```

### ❌ Actor Model이 부적합한 경우

```
1. 단순한 요청-응답
   ────────────────
   • 전통적 웹 API (Stateless)
   • CRUD 애플리케이션
   → 그냥 웹 프레임워크 사용

2. 강한 일관성 필요
   ────────────────
   • ACID 트랜잭션 필수
   • 즉각적인 일관성 요구
   → RDBMS + 2PC 고려

3. 순수 계산 작업
   ──────────────
   • 배치 데이터 처리
   • 수학적 계산
   → MapReduce, Spark 등

4. 단일 스레드로 충분
   ─────────────────
   • 처리량이 낮은 서비스
   • 단순한 스크립트
   → 복잡도만 증가
```

---

## 실제 판단 체크리스트

```
□ 동시에 처리해야 할 독립적인 엔티티가 많은가?
  → 예: 각 플레이어, 각 세션, 각 디바이스

□ 엔티티별로 상태를 유지해야 하는가?
  → 예: 로그인 상태, 게임 진행 상태

□ 시스템이 여러 서버로 확장되어야 하는가?
  → 예: 사용자 증가에 따른 스케일아웃

□ 부분 장애 시에도 서비스를 계속해야 하는가?
  → 예: 일부 기능 다운 시에도 다른 기능 동작

□ 실시간 상호작용이 필요한가?
  → 예: 채팅, 게임, 알림

위 중 3개 이상 "예" → Actor Model 고려
```

---

## 결론

```
┌─────────────────────────────────────────────────────────────┐
│              Actor Model을 선택하는 이유                     │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  "Lock으로 인한 복잡성을 제거하고,                           │
│   분산 시스템으로의 확장을 자연스럽게 하며,                   │
│   장애에 대한 회복력을 시스템 설계에 내장하기 위해"           │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

Actor Model은 **은총알(Silver Bullet)**이 아닙니다. 하지만 적합한 문제 영역에서는 다른 어떤 접근 방식보다 **단순하고, 안전하고, 확장 가능한** 솔루션을 제공합니다.

---

## 다음 단계

- [02. Core Concepts](../02-core-concepts/README.md) - Actor의 핵심 구성 요소 상세 학습
- [03. Actor vs Threads](../03-actor-vs-threads/README.md) - 성능과 메모리 비교 심화
