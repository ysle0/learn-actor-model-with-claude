# Akka.NET

> Akka의 .NET 포팅

## 개요

Akka.NET은 Akka(JVM)를 .NET 생태계로 포팅한 프레임워크입니다. C#, F#에서 Actor Model을 사용할 수 있으며, Akka의 주요 기능을 대부분 지원합니다.

```
┌─────────────────────────────────────────────────────────────────┐
│                    Akka.NET Modules                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   ┌─────────────┐  ┌─────────────┐  ┌─────────────┐            │
│   │ Akka.NET    │  │ Akka.Remote │  │ Akka.Cluster│            │
│   │  (Core)     │  │             │  │             │            │
│   └─────────────┘  └─────────────┘  └─────────────┘            │
│                                                                  │
│   ┌─────────────┐  ┌─────────────┐  ┌─────────────┐            │
│   │ Akka.Persist│  │ Akka.Streams│  │ Akka.DI     │            │
│   │             │  │             │  │             │            │
│   └─────────────┘  └─────────────┘  └─────────────┘            │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## 기본 사용법

### Actor 정의

```csharp
using Akka.Actor;

// 메시지 타입
public record Greet(string Who);
public record Greeted(string Message);

// Actor 클래스
public class GreeterActor : ReceiveActor
{
    public GreeterActor()
    {
        Receive<Greet>(greet =>
        {
            var message = $"Hello, {greet.Who}!";
            Console.WriteLine(message);
            Sender.Tell(new Greeted(message));
        });
    }
}
```

### Actor System 생성

```csharp
using Akka.Actor;

// ActorSystem 생성
var system = ActorSystem.Create("MySystem");

// Actor 생성
var greeter = system.ActorOf<GreeterActor>("greeter");

// 메시지 전송
greeter.Tell(new Greet("World"));

// Ask 패턴
var response = await greeter.Ask<Greeted>(new Greet("Akka.NET"));
Console.WriteLine(response.Message);

// 종료
await system.Terminate();
```

### Supervision

```csharp
public class SupervisorActor : ReceiveActor
{
    public SupervisorActor()
    {
        var child = Context.ActorOf<WorkerActor>("worker");

        Receive<string>(msg => child.Forward(msg));
    }

    protected override SupervisorStrategy SupervisorStrategy()
    {
        return new OneForOneStrategy(
            maxNrOfRetries: 10,
            withinTimeRange: TimeSpan.FromMinutes(1),
            decider: ex => ex switch
            {
                ArithmeticException => Directive.Resume,
                NullReferenceException => Directive.Restart,
                ArgumentException => Directive.Stop,
                _ => Directive.Escalate
            });
    }
}
```

## Akka.Cluster

```csharp
// HOCON 설정
var config = ConfigurationFactory.ParseString(@"
    akka {
        actor.provider = cluster
        remote {
            dot-netty.tcp {
                hostname = ""127.0.0.1""
                port = 8081
            }
        }
        cluster {
            seed-nodes = [""akka.tcp://MyCluster@127.0.0.1:8081""]
            roles = [""frontend""]
        }
    }
");

var system = ActorSystem.Create("MyCluster", config);
var cluster = Cluster.Get(system);

// 클러스터 이벤트 구독
cluster.Subscribe(
    Context.Self,
    ClusterEvent.SubscriptionInitialStateMode.InitialStateAsEvents,
    typeof(ClusterEvent.MemberUp));
```

## Akka.Persistence

```csharp
public record AddItem(string Item);
public record RemoveItem(string Item);
public record ItemAdded(string Item);
public record ItemRemoved(string Item);

public class CartActor : ReceivePersistentActor
{
    public override string PersistenceId => "cart-1";

    private List<string> _items = new();

    public CartActor()
    {
        // 명령 처리
        Command<AddItem>(cmd =>
        {
            Persist(new ItemAdded(cmd.Item), evt =>
            {
                _items.Add(evt.Item);
            });
        });

        Command<RemoveItem>(cmd =>
        {
            Persist(new ItemRemoved(cmd.Item), evt =>
            {
                _items.Remove(evt.Item);
            });
        });

        // 복구
        Recover<ItemAdded>(evt => _items.Add(evt.Item));
        Recover<ItemRemoved>(evt => _items.Remove(evt.Item));
    }
}
```

## NuGet 패키지

```xml
<PackageReference Include="Akka" Version="1.5.0" />
<PackageReference Include="Akka.Remote" Version="1.5.0" />
<PackageReference Include="Akka.Cluster" Version="1.5.0" />
<PackageReference Include="Akka.Persistence" Version="1.5.0" />
<PackageReference Include="Akka.Streams" Version="1.5.0" />
```

## Akka vs Akka.NET vs Orleans

| 기능 | Akka | Akka.NET | Orleans |
|------|------|----------|---------|
| 언어 | Scala/Java | C#/F# | C# |
| Actor 패턴 | Classic | Classic | Virtual |
| Supervision | 강력 | 강력 | 제한적 |
| Persistence | Event Sourcing | Event Sourcing | State |
| 학습 곡선 | 높음 | 높음 | 중간 |
| 라이센스 | BSL | Apache 2.0 | MIT |

## 관련 문서

- [Akka](./akka.md)
- [Orleans](./orleans.md)
- [프레임워크 비교](./comparison-table.md)
