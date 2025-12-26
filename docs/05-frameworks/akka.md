# Akka

> JVM 생태계의 Actor Model 구현

## 개요

Akka는 JVM(Scala/Java)에서 Actor Model을 구현한 툴킷입니다. Lightbend(구 Typesafe)에서 개발했으며, 분산 시스템 구축을 위한 포괄적인 도구를 제공합니다.

```
┌─────────────────────────────────────────────────────────────────┐
│                      Akka Ecosystem                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   ┌─────────────┐  ┌─────────────┐  ┌─────────────┐            │
│   │ Akka Actors │  │ Akka Streams│  │ Akka HTTP   │            │
│   │  (Core)     │  │  (Reactive) │  │  (REST API) │            │
│   └─────────────┘  └─────────────┘  └─────────────┘            │
│                                                                  │
│   ┌─────────────┐  ┌─────────────┐  ┌─────────────┐            │
│   │Akka Cluster │  │ Akka Persist│  │ Akka gRPC   │            │
│   │(Distribution)│  │  (Event Src)│  │  (RPC)      │            │
│   └─────────────┘  └─────────────┘  └─────────────┘            │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Akka Classic vs Akka Typed

### Classic (레거시)

```scala
import akka.actor.{Actor, ActorSystem, Props}

class CounterActor extends Actor {
  var count = 0

  def receive: Receive = {
    case "increment" =>
      count += 1
    case "get" =>
      sender() ! count
  }
}

val system = ActorSystem("MySystem")
val counter = system.actorOf(Props[CounterActor], "counter")
counter ! "increment"
```

### Typed (권장)

```scala
import akka.actor.typed.{ActorRef, ActorSystem, Behavior}
import akka.actor.typed.scaladsl.Behaviors

// 프로토콜 정의
sealed trait CounterCommand
case object Increment extends CounterCommand
case class GetCount(replyTo: ActorRef[Int]) extends CounterCommand

// Behavior 정의
object Counter {
  def apply(): Behavior[CounterCommand] = counter(0)

  private def counter(count: Int): Behavior[CounterCommand] =
    Behaviors.receiveMessage {
      case Increment =>
        counter(count + 1)
      case GetCount(replyTo) =>
        replyTo ! count
        Behaviors.same
    }
}

// 사용
val system = ActorSystem(Counter(), "CounterSystem")
system ! Increment
```

## 핵심 기능

### 1. Supervision

```scala
import akka.actor.typed.SupervisorStrategy
import scala.concurrent.duration._

val supervisedBehavior = Behaviors.supervise(
  Counter()
).onFailure[IllegalStateException](
  SupervisorStrategy.restart.withLimit(
    maxNrOfRetries = 10,
    withinTimeRange = 1.minute
  )
)
```

### 2. Clustering

```scala
// application.conf
akka {
  actor {
    provider = cluster
  }
  remote.artery {
    canonical {
      hostname = "127.0.0.1"
      port = 2551
    }
  }
  cluster {
    seed-nodes = [
      "akka://ClusterSystem@127.0.0.1:2551",
      "akka://ClusterSystem@127.0.0.1:2552"
    ]
  }
}
```

```scala
import akka.cluster.typed.Cluster

val cluster = Cluster(system)
cluster.manager ! Join(Address("akka", "ClusterSystem", "127.0.0.1", 2551))
```

### 3. Cluster Sharding

엔티티를 클러스터 전체에 분산:

```scala
import akka.cluster.sharding.typed.scaladsl._

// Entity 정의
object CounterEntity {
  val TypeKey = EntityTypeKey[CounterCommand]("Counter")

  def apply(entityId: String): Behavior[CounterCommand] = {
    Behaviors.setup { context =>
      counter(entityId, 0)
    }
  }

  private def counter(entityId: String, count: Int): Behavior[CounterCommand] =
    Behaviors.receiveMessage {
      case Increment =>
        counter(entityId, count + 1)
      case GetCount(replyTo) =>
        replyTo ! count
        Behaviors.same
    }
}

// Sharding 초기화
val sharding = ClusterSharding(system)
val counterRegion: ActorRef[ShardingEnvelope[CounterCommand]] =
  sharding.init(Entity(CounterEntity.TypeKey)(createBehavior = ctx =>
    CounterEntity(ctx.entityId)
  ))

// 사용
counterRegion ! ShardingEnvelope("counter-1", Increment)
```

### 4. Persistence (Event Sourcing)

```scala
import akka.persistence.typed.scaladsl._

sealed trait Command
case class Add(value: Int) extends Command
case class Get(replyTo: ActorRef[Int]) extends Command

sealed trait Event
case class Added(value: Int) extends Event

case class State(total: Int = 0) {
  def add(value: Int): State = copy(total = total + value)
}

object PersistentCounter {
  def apply(id: String): Behavior[Command] = {
    EventSourcedBehavior[Command, Event, State](
      persistenceId = PersistenceId.ofUniqueId(id),
      emptyState = State(),
      commandHandler = (state, command) => command match {
        case Add(value) =>
          Effect.persist(Added(value))
        case Get(replyTo) =>
          replyTo ! state.total
          Effect.none
      },
      eventHandler = (state, event) => event match {
        case Added(value) => state.add(value)
      }
    )
  }
}
```

### 5. Streams

반응형 스트림 처리:

```scala
import akka.stream.scaladsl._

val source = Source(1 to 100)
val flow = Flow[Int].map(_ * 2).filter(_ > 50)
val sink = Sink.foreach[Int](println)

source.via(flow).runWith(sink)

// 백프레셔 내장
val slowSink = Sink.foreach[Int] { n =>
  Thread.sleep(100)
  println(n)
}
// Source가 Sink 속도에 맞춰 조절됨
```

## 설정

### build.sbt

```scala
val AkkaVersion = "2.8.0"
libraryDependencies ++= Seq(
  "com.typesafe.akka" %% "akka-actor-typed" % AkkaVersion,
  "com.typesafe.akka" %% "akka-cluster-typed" % AkkaVersion,
  "com.typesafe.akka" %% "akka-cluster-sharding-typed" % AkkaVersion,
  "com.typesafe.akka" %% "akka-persistence-typed" % AkkaVersion,
  "com.typesafe.akka" %% "akka-stream" % AkkaVersion
)
```

### application.conf

```hocon
akka {
  loglevel = "INFO"

  actor {
    default-dispatcher {
      throughput = 10
    }

    serialization-bindings {
      "com.example.MyMessage" = jackson-json
    }
  }
}
```

## 장단점

### 장점

| 장점 | 설명 |
|------|------|
| 타입 안전성 | Akka Typed로 컴파일 타임 검증 |
| JVM 생태계 | Java/Scala 라이브러리 활용 |
| 포괄적 기능 | Cluster, Persistence, Streams 등 |
| 문서화 | 풍부한 문서와 예제 |
| 성능 | 높은 처리량 (50M msg/sec) |

### 단점

| 단점 | 설명 |
|------|------|
| 복잡성 | 학습 곡선 높음 |
| JVM 의존성 | JVM 외 환경 미지원 |
| 라이센스 | BSL (상업용 제한, v2.7+) |
| 설정 | 많은 설정 옵션 |

## 사용 사례

```
┌─────────────────────────────────────────────────────────────────┐
│                    Akka 사용 기업                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   LinkedIn    - 소셜 네트워크 백엔드                            │
│   Zalando     - 전자상거래 플랫폼                               │
│   ING Bank    - 금융 서비스                                     │
│   Verizon     - 통신 서비스                                     │
│   Intel       - 분석 플랫폼                                     │
│   Samsung     - IoT 플랫폼                                      │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## 관련 문서

- [Akka.NET](./akka-net.md)
- [프레임워크 비교](./comparison-table.md)
- [Orleans](./orleans.md)
