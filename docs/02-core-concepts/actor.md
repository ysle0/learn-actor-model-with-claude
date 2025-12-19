# Actor 상세

> Actor의 정의, 특성, 생명주기를 심층적으로 알아봅니다.

## Actor의 정의

Actor는 **동시성 프로그래밍의 기본 단위**입니다. 각 Actor는:

1. **고유한 ID(주소)**를 가짐
2. **캡슐화된 상태**를 가짐
3. **메시지를 받아 처리**하는 행위를 정의
4. **다른 Actor에게 메시지를 보낼 수 있음**
5. **새로운 Actor를 생성할 수 있음**

---

## Actor의 특성

### 1. 캡슐화 (Encapsulation)

```
┌─────────────────────────────────────────────────────────────┐
│                   진정한 캡슐화                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  OOP의 캡슐화 (불완전)                                       │
│  ─────────────────────                                      │
│  class Player {                                             │
│      private int health;  // 여러 스레드가 접근 가능!        │
│      public void damage(int n) { health -= n; }             │
│  }                                                          │
│                                                             │
│  Thread 1: player.damage(10)  ──┐                           │
│  Thread 2: player.damage(20)  ──┼── Race Condition!         │
│  Thread 3: player.damage(30)  ──┘                           │
│                                                             │
│  ─────────────────────────────────────────────────────────  │
│                                                             │
│  Actor의 캡슐화 (완전)                                       │
│  ───────────────────                                        │
│  class PlayerActor {                                        │
│      private int health;  // 오직 이 Actor만 접근           │
│      void receive(msg) { health -= msg.damage; }            │
│  }                                                          │
│                                                             │
│  Thread 1 ──▶ Mailbox ──┐                                   │
│  Thread 2 ──▶ Mailbox ──┼── 순차 처리! (안전)               │
│  Thread 3 ──▶ Mailbox ──┘                                   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 2. 비동기성 (Asynchrony)

모든 Actor 간 통신은 비동기입니다:

```cpp
// 메시지 전송은 블로킹되지 않음
self->send(other_actor, message);  // 즉시 리턴

// 필요하면 응답을 기다릴 수 있음
self->request(other_actor, std::chrono::seconds(5), message)
  .then([](int result) {
    // 응답 처리
  });
```

### 3. 격리 (Isolation)

각 Actor는 완전히 격리되어 있습니다:

```
Actor A의 장애가 Actor B에 영향을 주지 않음

┌─────────┐         ┌─────────┐
│ Actor A │   ✗     │ Actor B │
│  CRASH  │─────────│   OK    │
└─────────┘         └─────────┘
     │
     ▼
 Supervisor가 재시작
```

---

## Actor 생명주기

```
┌─────────────────────────────────────────────────────────────┐
│                     Actor 생명주기                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│                     ┌──────────┐                            │
│                     │  생성됨   │                            │
│                     │ (Created) │                            │
│                     └────┬─────┘                            │
│                          │                                  │
│                          ▼                                  │
│                     ┌──────────┐                            │
│              ┌─────▶│  시작됨   │◀─────┐                    │
│              │      │ (Started) │      │                    │
│              │      └────┬─────┘      │                    │
│              │           │            │                    │
│              │           ▼            │                    │
│              │      ┌──────────┐      │                    │
│         재시작│      │  실행중   │      │재시작              │
│      (Restart)│      │(Running) │      │(Restart)          │
│              │      └────┬─────┘      │                    │
│              │           │            │                    │
│              │      ┌────┴────┐       │                    │
│              │      ▼         ▼       │                    │
│              │ ┌────────┐ ┌────────┐  │                    │
│              └─│ 실패   │ │ 정지   │──┘                    │
│                │(Failed)│ │(Stopped)                       │
│                └────────┘ └────┬───┘                       │
│                                │                            │
│                                ▼                            │
│                          ┌──────────┐                       │
│                          │  종료됨   │                       │
│                          │(Terminated)                      │
│                          └──────────┘                       │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 생명주기 이벤트

#### Akka (Scala/Java)

```scala
class MyActor extends Actor {
  // 시작 전 호출
  override def preStart(): Unit = {
    println("Actor 시작됨")
  }

  // 종료 후 호출
  override def postStop(): Unit = {
    println("Actor 종료됨")
  }

  // 재시작 전 호출 (예외 정보 포함)
  override def preRestart(reason: Throwable, message: Option[Any]): Unit = {
    println(s"재시작 전: ${reason.getMessage}")
  }

  // 재시작 후 호출
  override def postRestart(reason: Throwable): Unit = {
    println("재시작 완료")
  }

  def receive = {
    case msg => // 메시지 처리
  }
}
```

#### Orleans (C#)

```csharp
public class PlayerGrain : Grain, IPlayerGrain
{
    public override Task OnActivateAsync(CancellationToken ct)
    {
        // Grain 활성화 시 호출
        Console.WriteLine("Grain 활성화됨");
        return base.OnActivateAsync(ct);
    }

    public override Task OnDeactivateAsync(DeactivationReason reason, CancellationToken ct)
    {
        // Grain 비활성화 시 호출
        Console.WriteLine($"Grain 비활성화됨: {reason}");
        return base.OnDeactivateAsync(reason, ct);
    }
}
```

#### C++ (CAF)

```cpp
struct player_state {
  int health = 100;
};

caf::behavior player_actor(caf::stateful_actor<player_state>* self) {
  // Actor 시작 시
  self->attach_functor([=](const caf::error&) {
    // Actor 종료 시 정리
    std::cout << "Actor 종료됨" << std::endl;
  });

  return {
    // 메시지 핸들러
  };
}
```

---

## Actor 주소 (Address)

### 로컬 주소

```
akka://MySystem/user/playerManager/player123
      │        │         │            │
      │        │         │            └── Actor 이름
      │        │         └── 부모 Actor
      │        └── 사용자 정의 Actor의 루트
      └── Actor System 이름
```

### 원격 주소

```
akka://MySystem@192.168.1.100:2552/user/playerManager/player123
                │              │
                │              └── 포트
                └── 호스트 주소
```

### 위치 투명성

```cpp
// 로컬이든 원격이든 동일한 코드
void send_command(actor_addr target) {
    self->send(target, command);  // target의 위치에 상관없이 동작
}
```

---

## Actor 생성 패턴

### 1. Top-Level Actor

```scala
// Akka
val system = ActorSystem("MySystem")
val topActor = system.actorOf(Props[MyActor], "topActor")
```

### 2. Child Actor

```scala
class ParentActor extends Actor {
  // 자식 Actor 생성
  val child = context.actorOf(Props[ChildActor], "child")

  def receive = {
    case msg => child.forward(msg)
  }
}
```

### 3. Pool/Router Actor

```scala
// 여러 Actor에게 작업 분배
val router = system.actorOf(
  RoundRobinPool(5).props(Props[WorkerActor]),
  "workerPool"
)
```

---

## Actor 종료

### 정상 종료

```scala
// Akka
context.stop(self)        // 자신 종료
context.stop(childActor)  // 자식 종료

// PoisonPill 메시지
actor ! PoisonPill        // 메시지 처리 후 종료
```

### 강제 종료

```scala
// 즉시 종료 (현재 메시지 처리 중단)
actor ! Kill
```

### 종료 감시 (Death Watch)

```scala
class WatcherActor extends Actor {
  val watched = context.actorOf(Props[WatchedActor])
  context.watch(watched)  // 감시 시작

  def receive = {
    case Terminated(ref) =>
      println(s"${ref.path} 가 종료됨")
  }
}
```

---

## Actor 계층 구조

```
                         /user
                           │
              ┌────────────┼────────────┐
              │            │            │
         /gameManager  /chatManager /statsManager
              │
     ┌────────┼────────┐
     │        │        │
  /room1   /room2   /room3
     │
  ┌──┴──┐
  │     │
/player1 /player2
```

**계층 구조의 의미:**
- 부모는 자식의 **Supervisor**
- 부모 종료 시 **모든 자식 종료**
- 메시지 전달 경로 제공

---

## 참고 자료

- [Akka Actor Reference](https://doc.akka.io/docs/akka/current/typed/actors.html)
- [Orleans Grain Lifecycle](https://learn.microsoft.com/en-us/dotnet/orleans/grains/)
- [CAF Actor Basics](https://actor-framework.readthedocs.io/)
