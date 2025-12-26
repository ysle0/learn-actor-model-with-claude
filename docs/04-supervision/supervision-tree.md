# 감독 트리 구조 (Supervision Tree)

> Actor들의 계층적 관리 구조

## 개요

감독 트리(Supervision Tree)는 Actor들을 계층적으로 구성하여 **장애 격리**와 **복구**를 체계적으로 관리하는 구조입니다.

```
┌─────────────────────────────────────────────────────────────────┐
│                    Supervision Tree                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│                        [Root Guardian]                          │
│                              │                                   │
│                              ▼                                   │
│                     [Application Supervisor]                    │
│                        /        \                               │
│                       /          \                              │
│              [Service A Sup]   [Service B Sup]                  │
│                /     \              |                           │
│               /       \             |                           │
│          [Worker]  [Worker]    [Worker Pool]                    │
│                                  /  |  \                        │
│                            [W1] [W2] [W3]                       │
│                                                                  │
│   부모 Actor = Supervisor (감독자)                               │
│   자식 Actor = Worker (작업자)                                   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## 트리 구조의 특징

### 1. 부모-자식 관계

```
부모 Actor의 역할:
• 자식 Actor 생성
• 자식 Actor 감독 (장애 감지)
• 장애 시 복구 전략 적용
• 자식 Actor 종료 관리

자식 Actor의 역할:
• 실제 작업 수행
• 장애 발생 시 부모에게 알림
• 부모의 지시에 따라 재시작
```

### 2. 장애 전파 방향

```
┌─────────────────────────────────────────────────────────────────┐
│              Failure Propagation                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   장애는 아래에서 위로 전파:                                     │
│                                                                  │
│        [Supervisor] ◀─── 장애 보고                              │
│             │                                                   │
│             │ 복구 결정                                          │
│             ▼                                                   │
│        [Worker] ✗ 장애 발생                                     │
│                                                                  │
│   복구 명령은 위에서 아래로:                                     │
│                                                                  │
│        [Supervisor] ───▶ 재시작 지시                            │
│             │                                                   │
│             ▼                                                   │
│        [Worker] ✓ 재시작됨                                      │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Akka에서의 구현

### Actor 생성과 계층 구조

```scala
class ParentActor extends Actor {
  // 자식 Actor 생성 - 자동으로 부모-자식 관계 형성
  val child1 = context.actorOf(Props[WorkerActor], "worker1")
  val child2 = context.actorOf(Props[WorkerActor], "worker2")

  // Actor 경로
  // child1: akka://System/user/parent/worker1
  // child2: akka://System/user/parent/worker2

  def receive: Receive = {
    case Work(task) =>
      child1 ! task  // 작업 위임
  }
}
```

### 감독 전략 설정

```scala
class SupervisorActor extends Actor {
  import akka.actor.OneForOneStrategy
  import akka.actor.SupervisorStrategy._
  import scala.concurrent.duration._

  override val supervisorStrategy = OneForOneStrategy(
    maxNrOfRetries = 10,
    withinTimeRange = 1.minute
  ) {
    case _: ArithmeticException      => Resume
    case _: NullPointerException     => Restart
    case _: IllegalArgumentException => Stop
    case _: Exception                => Escalate
  }

  def receive: Receive = {
    case CreateChild(name) =>
      context.actorOf(Props[WorkerActor], name)
  }
}
```

## Erlang/OTP에서의 구현

### Supervisor 정의

```erlang
-module(my_supervisor).
-behaviour(supervisor).

-export([start_link/0, init/1]).

start_link() ->
    supervisor:start_link({local, ?MODULE}, ?MODULE, []).

init([]) ->
    SupFlags = #{
        strategy => one_for_one,
        intensity => 10,    % 최대 재시작 횟수
        period => 60        % 기간 (초)
    },

    ChildSpecs = [
        #{
            id => worker1,
            start => {worker_module, start_link, [arg1]},
            restart => permanent,
            shutdown => 5000,
            type => worker
        },
        #{
            id => worker2,
            start => {worker_module, start_link, [arg2]},
            restart => transient,
            shutdown => 5000,
            type => worker
        }
    ],

    {ok, {SupFlags, ChildSpecs}}.
```

### 복합 Supervision Tree

```erlang
%%       [top_sup]
%%        /     \
%%   [service_sup]  [db_sup]
%%      |             |
%%   [worker]     [pool_sup]
%%                 /  |  \
%%             [w1] [w2] [w3]

init([]) ->
    SupFlags = #{strategy => one_for_all},

    Children = [
        #{
            id => service_sup,
            start => {service_sup, start_link, []},
            type => supervisor
        },
        #{
            id => db_sup,
            start => {db_sup, start_link, []},
            type => supervisor
        }
    ],

    {ok, {SupFlags, Children}}.
```

## 트리 설계 가이드라인

### 1. 역할에 따른 분리

```
┌─────────────────────────────────────────────────────────────────┐
│                Role-Based Tree Design                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   좋은 설계:                                                     │
│                                                                  │
│        [Application Supervisor]                                 │
│              /        \                                         │
│    [API Supervisor]  [Background Supervisor]                    │
│         |                    |                                  │
│    [Request Handler]   [Scheduler]                              │
│                              |                                  │
│                         [Job Workers]                           │
│                                                                  │
│   API와 백그라운드 작업이 서로 영향을 주지 않음                  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 2. 장애 범위 고려

```
중요한 서비스는 분리:

        [App Supervisor]
         /     |      \
   [Critical] [Normal] [Experimental]
       |          |           |
    (높은 안정성) (일반)   (장애 허용)

각 브랜치가 독립적으로 실패/복구
```

### 3. 의존성 고려

```
의존성이 있는 Actor는 같은 가지에:

    [DB Connection Supervisor]
              |
    [Connection Pool]
      /   |   |   \
    [C1] [C2] [C3] [C4]

연결 풀 전체가 함께 관리됨
```

## 실제 예시: 채팅 서버

```
┌─────────────────────────────────────────────────────────────────┐
│              Chat Server Supervision Tree                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│                    [Chat Application]                           │
│                          |                                      │
│            ┌─────────────┼─────────────┐                       │
│            │             │             │                        │
│     [Connection Sup] [Room Sup]  [Persistence Sup]             │
│          |              |              |                        │
│    ┌─────┴─────┐   ┌────┴────┐   ┌────┴────┐                   │
│    │           │   │         │   │         │                    │
│ [Socket    [Session] [Room 1] [Room N] [DB Pool]               │
│  Acceptor]  Manager]    |                  |                    │
│                    [User Actors]     [DB Connections]           │
│                                                                  │
│   설계 원칙:                                                     │
│   • 연결 문제가 채팅룸에 영향 없음                              │
│   • DB 문제가 메시지 전달에 영향 없음                           │
│   • 각 룸이 독립적으로 실패/복구                                │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## 관련 문서

- [Let it Crash 철학](./let-it-crash.md)
- [재시작 전략](./restart-strategies.md)
- [장애 허용 설계](./fault-tolerance.md)
