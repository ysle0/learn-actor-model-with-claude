# Akka 소스코드 분석

> Akka 프레임워크의 핵심 구조와 소스코드 분석 가이드입니다.

## 레포지토리 개요

```
📦 akka/akka
🌐 https://github.com/akka/akka
⭐ 13k+ stars
📝 Scala
📄 Apache-2.0 License
```

---

## 프로젝트 구조

```
akka/
├── akka-actor/                    # Classic Actor
│   └── src/main/scala/akka/actor/
│       ├── Actor.scala            # Actor 트레이트
│       ├── ActorRef.scala         # Actor 참조
│       ├── Props.scala            # Actor 생성 설정
│       └── Mailbox.scala          # 메일박스
│
├── akka-actor-typed/              # Typed Actor (권장)
│   └── src/main/scala/akka/actor/typed/
│       ├── Behavior.scala         # 행위 정의
│       ├── ActorContext.scala     # 컨텍스트
│       └── ActorSystem.scala      # 액터 시스템
│
├── akka-cluster/                  # 클러스터링
├── akka-persistence/              # 이벤트 소싱
├── akka-stream/                   # 스트림 처리
└── akka-remote/                   # 원격 통신
```

---

## 핵심 개념 분석

### 1. Classic Actor

```scala
// 위치: akka-actor/src/main/scala/akka/actor/Actor.scala

trait Actor {
  // 암시적 컨텍스트
  implicit val context: ActorContext

  // 자기 자신에 대한 참조
  implicit final val self: ActorRef = context.self

  // 메시지 발신자
  final def sender(): ActorRef = context.sender()

  // 핵심: 메시지 처리 정의
  def receive: Receive

  // 생명주기 훅
  def preStart(): Unit = ()
  def postStop(): Unit = ()
  def preRestart(reason: Throwable, message: Option[Any]): Unit = {
    context.children.foreach { child =>
      context.stop(child)
    }
    postStop()
  }
  def postRestart(reason: Throwable): Unit = preStart()
}

// Receive는 PartialFunction
type Receive = PartialFunction[Any, Unit]

// 사용 예시
class MyActor extends Actor {
  def receive: Receive = {
    case "hello" => sender() ! "world"
    case n: Int  => sender() ! n * 2
  }
}
```

### 2. Typed Actor (Behavior)

```scala
// 위치: akka-actor-typed/src/main/scala/akka/actor/typed/Behavior.scala

// 타입 안전한 Actor
object Behaviors {
  // 메시지 처리 정의
  def receive[T](onMessage: (ActorContext[T], T) => Behavior[T]): Behavior[T]

  // 상태를 가진 Actor
  def setup[T](factory: ActorContext[T] => Behavior[T]): Behavior[T]

  // 행위 전환
  def same[T]: Behavior[T]
  def stopped[T]: Behavior[T]
}

// 사용 예시
object Counter {
  sealed trait Command
  case class Increment(replyTo: ActorRef[Int]) extends Command
  case class GetValue(replyTo: ActorRef[Int]) extends Command

  def apply(count: Int = 0): Behavior[Command] =
    Behaviors.receiveMessage {
      case Increment(replyTo) =>
        replyTo ! (count + 1)
        Counter(count + 1)  // 새 상태로 전환

      case GetValue(replyTo) =>
        replyTo ! count
        Behaviors.same
    }
}
```

### 3. ActorRef (메시지 전송)

```scala
// 위치: akka-actor/src/main/scala/akka/actor/ActorRef.scala

abstract class ActorRef {
  // Tell (fire-and-forget)
  def !(message: Any)(implicit sender: ActorRef = Actor.noSender): Unit

  // Ask (request-response)
  // akka-actor-typed에서
  def ask[Req, Res](f: ActorRef[Res] => Req)(
    implicit timeout: Timeout
  ): Future[Res]

  // Actor 경로
  def path: ActorPath
}

// 내부 구현
private[akka] class LocalActorRef(
  override val path: ActorPath,
  val underlying: ActorCell
) extends ActorRef {

  override def !(message: Any)(implicit sender: ActorRef): Unit = {
    // 메일박스에 메시지 추가
    underlying.sendMessage(Envelope(message, sender))
  }
}
```

### 4. Mailbox (메일박스)

```scala
// 위치: akka-actor/src/main/scala/akka/dispatch/Mailbox.scala

abstract class Mailbox {
  def enqueue(receiver: ActorRef, msg: Envelope): Unit
  def dequeue(): Envelope
  def hasMessages: Boolean
  def numberOfMessages: Int
}

// 기본 구현: 무제한 큐
class UnboundedMailbox extends Mailbox {
  private val queue = new ConcurrentLinkedQueue[Envelope]()

  def enqueue(receiver: ActorRef, msg: Envelope): Unit =
    queue.offer(msg)

  def dequeue(): Envelope =
    queue.poll()
}

// 우선순위 큐
class PriorityMailbox extends Mailbox {
  private val queue = new PriorityBlockingQueue[Envelope](
    11, // initial capacity
    PriorityComparator
  )
  // ...
}
```

### 5. Supervision (감독)

```scala
// 위치: akka-actor-typed/src/main/scala/akka/actor/typed/SupervisorStrategy.scala

sealed trait SupervisorStrategy

object SupervisorStrategy {
  // 재시작
  def restart: SupervisorStrategy = Restart

  // 중지
  def stop: SupervisorStrategy = Stop

  // 재개 (상태 유지)
  def resume: SupervisorStrategy = Resume

  // 부모에게 에스컬레이션
  def escalate: SupervisorStrategy = Escalate

  // 백오프 재시작
  def restartWithBackoff(
    minBackoff: FiniteDuration,
    maxBackoff: FiniteDuration,
    randomFactor: Double
  ): SupervisorStrategy
}

// 사용 예시
val supervised = Behaviors.supervise(myBehavior)
  .onFailure[IllegalStateException](SupervisorStrategy.restart)
```

---

## Akka Persistence (이벤트 소싱)

```scala
// 위치: akka-persistence-typed/

object PersistentCounter {
  // 커맨드
  sealed trait Command
  case class Increment(replyTo: ActorRef[Int]) extends Command
  case object GetValue extends Command

  // 이벤트
  sealed trait Event
  case class Incremented(delta: Int) extends Event

  // 상태
  case class State(value: Int)

  def apply(id: String): Behavior[Command] =
    EventSourcedBehavior[Command, Event, State](
      persistenceId = PersistenceId.ofUniqueId(id),
      emptyState = State(0),
      commandHandler = (state, cmd) => cmd match {
        case Increment(replyTo) =>
          Effect.persist(Incremented(1))
            .thenReply(replyTo)(_ => state.value + 1)
      },
      eventHandler = (state, evt) => evt match {
        case Incremented(delta) =>
          State(state.value + delta)
      }
    )
}
```

---

## Akka Cluster

```scala
// 위치: akka-cluster/src/main/scala/akka/cluster/

// 클러스터 멤버십
val cluster = Cluster(system)
cluster.subscribe(self, classOf[MemberEvent])

// Cluster Sharding
val sharding = ClusterSharding(system)

val TypeKey = EntityTypeKey[Counter.Command]("Counter")

val shardRegion = sharding.init(Entity(TypeKey) { entityContext =>
  Counter(entityContext.entityId)
})

// 엔티티에 메시지 전송
shardRegion ! ShardingEnvelope(entityId, Counter.Increment)
```

---

## 학습 포인트

```
Akka 핵심 설계 원칙:
────────────────────
1. 모든 것은 Actor
   - 상태, 행위, 메일박스를 가진 독립 엔티티

2. 메시지 패싱만
   - 공유 상태 없음
   - 불변 메시지 권장

3. 계층적 감독
   - 부모가 자식 감독
   - 장애 격리 및 복구

4. 위치 투명성
   - 로컬/원격 동일한 API
   - ActorRef가 추상화
```

### 코드 리딩 순서

```
1단계: Actor 기초
────────────────
akka-actor/Actor.scala
akka-actor/ActorRef.scala
akka-actor/Props.scala

2단계: 메시지 전달
────────────────
akka-actor/Mailbox.scala
akka-actor/Dispatcher.scala

3단계: Typed API
────────────────
akka-actor-typed/Behavior.scala
akka-actor-typed/ActorContext.scala

4단계: 클러스터
────────────────
akka-cluster/Cluster.scala
akka-cluster-sharding/
```

---

## Akka.NET과의 차이점

```
┌─────────────────────────────────────────────────────────────────┐
│              Akka (JVM) vs Akka.NET                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Akka (Scala/Java)        Akka.NET (C#)                        │
│  ─────────────────        ─────────────                        │
│  case class              record                                │
│  Behavior[T]             Receive<T>                            │
│  ! (tell)                Tell()                                │
│  ? (ask)                 Ask<T>()                              │
│  Props                   Props.Create<T>()                     │
│  ActorSystem             ActorSystem.Create()                  │
│                                                                 │
│  API는 유사하지만 언어 관용구가 다름                            │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 참고 자료

- [Akka Documentation](https://doc.akka.io/)
- [Akka GitHub](https://github.com/akka/akka)
- [Lightbend Academy](https://academy.lightbend.com/)

---

## 다음 단계

- [orleans-repo.md](./orleans-repo.md) - Orleans 분석
- [proto-actor-repo.md](./proto-actor-repo.md) - Proto.Actor 분석
- [game-frameworks.md](./game-frameworks.md) - 게임 프레임워크 분석
