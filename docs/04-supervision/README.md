# 04. Supervision - 감독 시스템

> Actor Model의 핵심인 장애 허용 시스템과 감독 트리를 알아봅니다.

## 한 줄 요약

**"Let it Crash" - 에러를 숨기지 말고, Supervisor가 복구하게 하라**

---

## Supervision이란?

Supervision은 Actor 계층 구조에서 **부모 Actor(Supervisor)**가 **자식 Actor(Worker)**의 장애를 감시하고 복구하는 메커니즘입니다.

```
┌─────────────────────────────────────────────────────────────┐
│                     Supervision 구조                        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│                      ┌──────────────┐                       │
│                      │  Supervisor  │                       │
│                      │              │                       │
│                      │  - 감시      │                       │
│                      │  - 재시작    │                       │
│                      │  - 정책 적용 │                       │
│                      └──────┬───────┘                       │
│                             │                               │
│              ┌──────────────┼──────────────┐               │
│              │              │              │               │
│              ▼              ▼              ▼               │
│       ┌──────────┐   ┌──────────┐   ┌──────────┐          │
│       │ Worker 1 │   │ Worker 2 │   │ Worker 3 │          │
│       │          │   │    💥    │   │          │          │
│       │   정상   │   │   장애   │   │   정상   │          │
│       └──────────┘   └──────────┘   └──────────┘          │
│                             │                               │
│                             ▼                               │
│                      Supervisor에게 통지                    │
│                             │                               │
│                             ▼                               │
│                      정책에 따라 처리                        │
│                      (재시작/무시/중단)                      │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## "Let it Crash" 철학

### 전통적 방식 vs Actor 방식

```
┌─────────────────────────────────────────────────────────────┐
│                  에러 처리 철학 비교                         │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  전통적 방식 (Defensive Programming)                        │
│  ─────────────────────────────────                          │
│  try {                                                      │
│      operation1();                                          │
│      try {                                                  │
│          operation2();                                      │
│      } catch (...) {                                        │
│          // 복구 시도                                        │
│          try {                                              │
│              recover();                                     │
│          } catch (...) {                                    │
│              // 또 다른 복구...                              │
│          }                                                  │
│      }                                                      │
│  } catch (...) { /* 끝없는 중첩 */ }                        │
│                                                             │
│  ─────────────────────────────────────────────────────────  │
│                                                             │
│  Actor 방식 (Let it Crash)                                  │
│  ────────────────────────                                   │
│  def receive = {                                            │
│      case msg => operation(msg)  // 그냥 실행               │
│  }                                                          │
│  // 에러 발생? → 죽음 → Supervisor가 재시작                  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 왜 "Let it Crash"인가?

```
1. 단순성
   ────────
   • 복잡한 에러 핸들링 불필요
   • 비즈니스 로직에 집중
   • 코드 가독성 향상

2. 신뢰성
   ────────
   • 알려진 좋은 상태로 복구
   • 부분 장애 → 부분 복구
   • 예측 불가능한 상태 방지

3. 격리
   ────────
   • 장애가 전파되지 않음
   • 다른 Actor에 영향 없음
   • 시스템 전체 안정성 유지
```

---

## 감독 트리 (Supervision Tree)

```
                            /user (Guardian)
                               │
                 ┌─────────────┼─────────────┐
                 │             │             │
            /gameManager  /chatManager  /statsManager
                 │             │
        ┌────────┼────────┐    │
        │        │        │    │
     /room1   /room2   /room3  /chatRoom1
        │
   ┌────┼────┐
   │    │    │
/p1   /p2   /p3 (Players)
```

### 계층 구조의 의미

| 레벨 | 역할 | 장애 시 |
|------|------|---------|
| Guardian | 시스템 최상위 | 전체 시스템 종료 |
| Manager | 서비스 단위 관리 | 하위 서비스 영향 |
| Worker | 실제 작업 수행 | 해당 작업만 영향 |

---

## 재시작 전략 (Restart Strategies)

### 1. One-for-One

실패한 자식만 재시작:

```
Before:  [A] [B] [C]
              ↓ 💥
After:   [A] [B'] [C]   ← B만 재시작
```

```scala
// Akka
OneForOneStrategy(maxNrOfRetries = 10, withinTimeRange = 1.minute) {
  case _: ArithmeticException => Resume
  case _: NullPointerException => Restart
  case _: Exception => Stop
}
```

### 2. One-for-All

하나라도 실패하면 모든 자식 재시작:

```
Before:  [A] [B] [C]
              ↓ 💥
After:   [A'] [B'] [C']   ← 전체 재시작
```

**사용 사례:** 자식들이 서로 의존적일 때

### 3. Rest-for-One

실패한 것과 그 이후 생성된 자식들 재시작:

```
생성 순서: A → B → C → D

Before:  [A] [B] [C] [D]
              ↓ 💥
After:   [A] [B'] [C'] [D']   ← B와 이후 것들
```

**사용 사례:** 파이프라인 처리

---

## 재시작 정책

### 재시작 제한

```scala
// 1분 내에 10번 초과 재시작 → 상위로 에스컬레이션
OneForOneStrategy(
  maxNrOfRetries = 10,
  withinTimeRange = 1.minute
)
```

### 에러 타입별 처리

```scala
val strategy = OneForOneStrategy() {
  case _: IllegalArgumentException => Resume    // 계속 진행
  case _: IllegalStateException => Restart      // 재시작
  case _: NullPointerException => Stop          // 중단
  case _: Exception => Escalate                 // 상위로 전달
}
```

```
┌─────────────────────────────────────────────────────────────┐
│                     처리 방식                               │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Resume (계속)                                              │
│  ─────────────                                              │
│  • 현재 메시지 무시하고 다음 메시지 처리                      │
│  • 상태 유지                                                │
│  • 경미한 에러에 사용                                       │
│                                                             │
│  Restart (재시작)                                           │
│  ───────────────                                            │
│  • Actor 인스턴스 새로 생성                                  │
│  • 상태 초기화                                              │
│  • 복구 가능한 에러에 사용                                   │
│                                                             │
│  Stop (중단)                                                │
│  ───────────                                                │
│  • Actor 영구 종료                                          │
│  • 치명적 에러에 사용                                       │
│                                                             │
│  Escalate (에스컬레이션)                                    │
│  ────────────────────                                       │
│  • 상위 Supervisor에게 결정 위임                            │
│  • 처리 방법 모를 때 사용                                   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 구현 예제

### Akka (Scala)

```scala
class Supervisor extends Actor {
  // 감독 전략 정의
  override val supervisorStrategy =
    OneForOneStrategy(maxNrOfRetries = 3, withinTimeRange = 1.minute) {
      case _: IOException => Restart
      case _: Exception => Stop
    }

  override def preStart(): Unit = {
    // 자식 Actor 생성
    context.actorOf(Props[Worker], "worker1")
    context.actorOf(Props[Worker], "worker2")
  }

  def receive = {
    case msg => // 메시지 처리
  }
}

class Worker extends Actor {
  def receive = {
    case "fail" => throw new IOException("Simulated failure")
    case msg => println(s"Received: $msg")
  }

  override def preRestart(reason: Throwable, message: Option[Any]): Unit = {
    println(s"Restarting due to: ${reason.getMessage}")
  }
}
```

### Orleans (C#)

```csharp
// Orleans는 자동 재활성화 제공
public class PlayerGrain : Grain, IPlayerGrain
{
    private PlayerState _state;

    public override async Task OnActivateAsync(CancellationToken ct)
    {
        // 활성화 시 상태 로드
        _state = await LoadStateAsync();
    }

    public async Task DoRiskyOperation()
    {
        // 예외 발생 시 → Grain 비활성화
        // 다음 호출 시 → 자동 재활성화
    }
}
```

### Erlang

```erlang
-module(supervisor_example).
-behaviour(supervisor).

init([]) ->
    SupFlags = #{
        strategy => one_for_one,
        intensity => 10,      % 최대 재시작 횟수
        period => 60          % 기간 (초)
    },

    ChildSpecs = [
        #{
            id => worker1,
            start => {worker, start_link, []},
            restart => permanent,  % 항상 재시작
            shutdown => 5000,
            type => worker
        }
    ],

    {ok, {SupFlags, ChildSpecs}}.
```

---

## 실제 적용 패턴

### Error Kernel 패턴

```
┌─────────────────────────────────────────────────────────────┐
│                   Error Kernel 패턴                         │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│                    ┌────────────────┐                       │
│                    │ Error Kernel   │  ← 절대 실패하면      │
│                    │ (핵심 로직)     │     안 되는 코드      │
│                    │ - 단순         │     (최소한의 기능)   │
│                    │ - 테스트됨     │                       │
│                    └───────┬────────┘                       │
│                            │                                │
│              ┌─────────────┼─────────────┐                 │
│              │             │             │                 │
│              ▼             ▼             ▼                 │
│         ┌────────┐    ┌────────┐    ┌────────┐            │
│         │ 위험한  │    │ 위험한  │    │ 위험한  │            │
│         │ 작업 1  │    │ 작업 2  │    │ 작업 3  │            │
│         │        │    │        │    │        │            │
│         │ 실패 OK │    │ 실패 OK │    │ 실패 OK │            │
│         └────────┘    └────────┘    └────────┘            │
│                                                             │
│  → 위험한 작업은 깊은 곳에, 안전한 코드는 위에              │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 심화 문서

| 주제 | 설명 | 링크 |
|------|------|------|
| 감독 트리 설계 | 계층 구조 설계 방법 | [supervision-tree.md](./supervision-tree.md) |
| Let it Crash | 철학과 실천 | [let-it-crash.md](./let-it-crash.md) |
| 재시작 전략 | 전략별 상세 | [restart-strategies.md](./restart-strategies.md) |
| 장애 허용 설계 | 시스템 설계 패턴 | [fault-tolerance.md](./fault-tolerance.md) |

---

## 다음 단계

- [05. Frameworks](../05-frameworks/README.md) - 프레임워크별 Supervision 구현
- [06. Game Server](../06-game-server/README.md) - 게임 서버에서의 장애 처리
