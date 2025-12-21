# Actor Model 안티패턴

> 피해야 할 일반적인 실수와 올바른 해결책

## 개요

Actor Model을 처음 사용할 때 빠지기 쉬운 함정들과 그 해결책을 소개합니다. 이러한 안티패턴을 인식하고 피하면 더 견고하고 효율적인 시스템을 구축할 수 있습니다.

---

## 1. 가변 상태 공유 (Sharing Mutable State)

### 문제

Actor 간에 가변 객체를 공유하면 Actor Model의 핵심 원칙인 상태 격리가 깨집니다.

```typescript
// ❌ 나쁜 예
class BadActor extends Actor<Message> {
  protected receive(message: Message): void {
    if (message.type === 'PROCESS_DATA') {
      // 가변 배열을 다른 Actor에게 전달
      const mutableList = [1, 2, 3];
      otherActor.send({ type: 'WORK', data: mutableList });

      // 동시에 같은 배열 수정
      mutableList.push(4);  // Race condition!
    }
  }
}
```

```
┌─────────────────────────────────────────────────────────────────┐
│                    Shared Mutable State Problem                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   Actor A                    Shared Data                Actor B  │
│   ┌─────┐                   ┌─────────┐               ┌─────┐   │
│   │     │──── reference ───▶│ [1,2,3] │◀── reference ──│     │   │
│   │     │                   └────┬────┘               │     │   │
│   │     │── push(4) ────────────┼──────────── pop() ──│     │   │
│   └─────┘                       │                     └─────┘   │
│                                 ▼                               │
│                           Data Corruption!                      │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 해결책

항상 불변 데이터나 깊은 복사본을 전달합니다.

```typescript
// ✅ 좋은 예
class GoodActor extends Actor<Message> {
  protected receive(message: Message): void {
    if (message.type === 'PROCESS_DATA') {
      // 불변 복사본 전달
      const immutableList = Object.freeze([1, 2, 3]);
      otherActor.send({ type: 'WORK', data: [...immutableList] });

      // 또는 새 배열 생성
      const newList = [...immutableList, 4];
    }
  }
}
```

```scala
// Scala에서의 불변 데이터 사용
case class DataMessage(data: List[Int])  // List는 불변

def receive: Receive = {
  case ProcessData =>
    val immutableList = List(1, 2, 3)
    otherActor ! DataMessage(immutableList)  // 안전
}
```

---

## 2. Sender 클로저 캡처 (Closing Over Sender)

### 문제

비동기 콜백 내에서 `sender()`를 호출하면 예상과 다른 Actor에게 응답할 수 있습니다.

```scala
// ❌ 나쁜 예
def receive: Receive = {
  case GetData =>
    Future {
      val result = fetchDataFromDb()
      sender() ! result  // sender()가 이미 바뀌었을 수 있음!
    }
}
```

```
┌─────────────────────────────────────────────────────────────────┐
│                    Sender Capture Problem                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   시간 ────────────────────────────────────────────────▶        │
│                                                                  │
│   t1: ActorA sends GetData                                      │
│       sender() = ActorA ✓                                       │
│                                                                  │
│   t2: ActorB sends AnotherMessage (Future 실행 중)              │
│       sender() = ActorB ← 변경됨!                               │
│                                                                  │
│   t3: Future completes, calls sender()                          │
│       sender() ! result  → ActorB에게 전송됨 ✗                  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 해결책

`sender()` 참조를 미리 캡처합니다.

```scala
// ✅ 좋은 예
def receive: Receive = {
  case GetData =>
    val replyTo = sender()  // 미리 캡처
    Future {
      val result = fetchDataFromDb()
      replyTo ! result  // 캡처된 참조 사용
    }
}
```

```scala
// 또는 pipe 패턴 사용
import akka.pattern.pipe

def receive: Receive = {
  case GetData =>
    fetchDataFromDb().pipeTo(sender())
}
```

---

## 3. 너무 많은 Actor (Actor Per Operation)

### 문제

모든 작은 작업에 Actor를 생성하면 오버헤드가 증가합니다.

```typescript
// ❌ 나쁜 예
class StringProcessorActor extends Actor<string> {
  protected receive(str: string): void {
    // 단순 문자열 연결에 Actor는 과잉
    return str.toUpperCase();
  }
}

// 호출할 때마다 새 Actor 생성
for (const item of items) {
  const actor = new StringProcessorActor();
  actor.send(item);
}
```

### 해결책

Actor는 의미 있는 도메인 단위로 사용합니다.

```typescript
// ✅ 좋은 예
class OrderProcessorActor extends Actor<OrderMessage> {
  protected receive(message: OrderMessage): void {
    switch (message.type) {
      case 'CREATE_ORDER':
        this.createOrder(message.order);  // 의미 있는 비즈니스 로직
        break;
      case 'UPDATE_ORDER':
        this.updateOrder(message.orderId, message.updates);
        break;
    }
  }

  // 간단한 문자열 처리는 내부 메서드로
  private formatOrderId(id: string): string {
    return id.toUpperCase();
  }
}
```

```
┌─────────────────────────────────────────────────────────────────┐
│              Actor Granularity Guidelines                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   너무 세분화 (Bad)              적절한 크기 (Good)             │
│   ─────────────────              ────────────────               │
│                                                                  │
│   StringConcatActor              OrderActor                     │
│   AddOneActor            vs      PaymentActor                   │
│   ToUpperCaseActor               InventoryActor                 │
│                                                                  │
│   오버헤드: 높음                 오버헤드: 적절                  │
│   의미: 없음                     의미: 도메인 개념               │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 4. Ask 패턴 남용

### 문제

모든 통신에 `ask`(request-reply)를 사용하면 성능이 저하되고 데드락 위험이 있습니다.

```scala
// ❌ 나쁜 예
def receive: Receive = {
  case DoWork =>
    // 순차적 ask - 비효율적
    val result1 = Await.result(actor1 ? Request1, 5.seconds)
    val result2 = Await.result(actor2 ? Request2, 5.seconds)
    val result3 = Await.result(actor3 ? Request3, 5.seconds)

    // 각각 5초씩 대기 = 최대 15초
}
```

```scala
// ❌ 데드락 위험
def receive: Receive = {
  case Request =>
    // 자신에게 ask하면 데드락!
    val result = Await.result(self ? InternalRequest, 5.seconds)
}
```

### 해결책

`tell`을 기본으로 사용하고, 필요한 경우만 `ask`를 병렬로 사용합니다.

```scala
// ✅ 좋은 예 - Tell 패턴
def receive: Receive = {
  case DoWork =>
    actor1 ! Request1
    actor2 ! Request2
    actor3 ! Request3
    // 비동기로 진행
}

// ✅ 좋은 예 - 병렬 Ask
def receive: Receive = {
  case DoWork =>
    val future1 = actor1 ? Request1
    val future2 = actor2 ? Request2
    val future3 = actor3 ? Request3

    // 병렬 실행
    for {
      r1 <- future1
      r2 <- future2
      r3 <- future3
    } yield combine(r1, r2, r3)
}
```

```
┌─────────────────────────────────────────────────────────────────┐
│                 Ask vs Tell Performance                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   Sequential Ask:                                                │
│   [──wait──][──wait──][──wait──]  Total: 15s                    │
│                                                                  │
│   Parallel Ask:                                                  │
│   [──wait──]                                                    │
│   [──wait──]                       Total: 5s                    │
│   [──wait──]                                                    │
│                                                                  │
│   Tell (Fire-and-Forget):                                       │
│   [send][send][send]              Total: ~0s                    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 5. 동기 블로킹 (Blocking Inside Actor)

### 문제

Actor 내에서 블로킹 작업을 수행하면 메시지 처리가 중단됩니다.

```scala
// ❌ 나쁜 예
def receive: Receive = {
  case FetchData(url) =>
    // 블로킹 I/O - 다른 메시지 처리 불가
    val response = Http.get(url).execute()  // 블로킹!
    sender() ! response
}
```

### 해결책

블로킹 작업은 별도의 스레드 풀에서 실행합니다.

```scala
// ✅ 좋은 예
implicit val blockingDispatcher =
  system.dispatchers.lookup("blocking-dispatcher")

def receive: Receive = {
  case FetchData(url) =>
    val replyTo = sender()
    Future {
      Http.get(url).execute()  // 별도 스레드 풀에서 실행
    }(blockingDispatcher).pipeTo(replyTo)
}
```

```
┌─────────────────────────────────────────────────────────────────┐
│                Blocking vs Non-Blocking                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   Blocking (Bad):                                                │
│   Actor Thread ━━━━━━━━━━━━━━━━━━━━━━━━━━                       │
│                 ↑ I/O 대기 중 다른 메시지 처리 불가             │
│                                                                  │
│   Non-Blocking (Good):                                           │
│   Actor Thread ━━━▪━━━▪━━━▪━━━                                  │
│                   │   │   │   (메시지 처리 계속)                │
│   I/O Thread  ━━━━━━━━━━━━━━━━                                  │
│                    (블로킹은 별도 스레드)                        │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 6. God Actor

### 문제

하나의 Actor가 너무 많은 책임을 가지면 유지보수가 어렵고 병목이 됩니다.

```scala
// ❌ 나쁜 예 - God Actor
class EverythingActor extends Actor {
  def receive: Receive = {
    case HandleOrder(o) => // 주문 처리
    case ProcessPayment(p) => // 결제 처리
    case UpdateInventory(i) => // 재고 업데이트
    case SendEmail(e) => // 이메일 발송
    case GenerateReport(r) => // 리포트 생성
    case HandleCustomer(c) => // 고객 관리
    case ManageShipping(s) => // 배송 관리
    // ... 더 많은 책임들
  }
}
```

### 해결책

단일 책임 원칙에 따라 Actor를 분리합니다.

```scala
// ✅ 좋은 예 - 책임 분리
class OrderActor extends Actor { /* 주문만 */ }
class PaymentActor extends Actor { /* 결제만 */ }
class InventoryActor extends Actor { /* 재고만 */ }
class EmailActor extends Actor { /* 이메일만 */ }
class ReportActor extends Actor { /* 리포트만 */ }
```

---

## 7. 이벤트 루프 차단

### 문제

Actor의 receive 메서드에서 무한 루프나 긴 계산을 수행하면 시스템이 멈춥니다.

```typescript
// ❌ 나쁜 예
protected receive(message: Message): void {
  while (true) {  // 무한 루프!
    doSomeWork();
    if (shouldStop()) break;  // 도달하지 않을 수도 있음
  }
}
```

### 해결책

작업을 청크로 나누고 self에게 메시지를 보내 진행합니다.

```typescript
// ✅ 좋은 예
protected receive(message: Message): void {
  switch (message.type) {
    case 'START_WORK':
      this.workQueue = prepareWork();
      this.self.send({ type: 'PROCESS_CHUNK' });
      break;

    case 'PROCESS_CHUNK':
      const chunk = this.workQueue.splice(0, 100);  // 100개씩
      processChunk(chunk);

      if (this.workQueue.length > 0) {
        this.self.send({ type: 'PROCESS_CHUNK' });  // 다음 청크
      } else {
        this.self.send({ type: 'WORK_COMPLETE' });
      }
      break;
  }
}
```

---

## 8. 에러 무시

### 문제

Actor 내에서 예외를 삼키면 문제를 숨기게 됩니다.

```scala
// ❌ 나쁜 예
def receive: Receive = {
  case msg =>
    try {
      process(msg)
    } catch {
      case _: Exception => // 아무것도 안 함 - 문제 숨김
    }
}
```

### 해결책

Supervision 전략을 활용하고 적절히 로깅합니다.

```scala
// ✅ 좋은 예
override val supervisorStrategy = OneForOneStrategy(
  maxNrOfRetries = 10,
  withinTimeRange = 1.minute
) {
  case _: DatabaseException => Restart
  case _: ValidationException => Resume
  case e: Exception =>
    log.error(e, "Unexpected error")
    Escalate
}
```

---

## 9. 순환 의존성

### 문제

Actor 간 순환 메시지가 무한 루프를 유발할 수 있습니다.

```
┌─────────────────────────────────────────────────────────────────┐
│                   Circular Dependency Problem                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   ┌─────────┐    message    ┌─────────┐                        │
│   │ Actor A │ ────────────▶ │ Actor B │                        │
│   │         │               │         │                        │
│   │         │ ◀──────────── │         │                        │
│   └─────────┘    message    └─────────┘                        │
│        │                         │                              │
│        └─────────────────────────┘                             │
│              무한 루프 발생!                                    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 해결책

종료 조건을 명확히 하고, 메시지에 TTL이나 hop count를 추가합니다.

```typescript
// ✅ 좋은 예
interface Message {
  type: string;
  ttl: number;  // 또는 hopCount
}

protected receive(message: Message): void {
  if (message.ttl <= 0) {
    console.log('Message expired, dropping');
    return;
  }

  otherActor.send({ ...message, ttl: message.ttl - 1 });
}
```

---

## 안티패턴 체크리스트

| 안티패턴 | 증상 | 해결책 |
|---------|------|--------|
| 가변 상태 공유 | 데이터 불일치, Race condition | 불변 데이터 사용 |
| Sender 클로저 캡처 | 잘못된 응답 수신자 | 미리 sender() 캡처 |
| 너무 많은 Actor | 높은 오버헤드 | 도메인 단위로 설계 |
| Ask 남용 | 성능 저하, 데드락 | Tell 기본, 병렬 Ask |
| 블로킹 작업 | 응답 지연 | 별도 스레드 풀 사용 |
| God Actor | 유지보수 어려움 | 책임 분리 |
| 이벤트 루프 차단 | 시스템 멈춤 | 청크 처리, self 메시지 |
| 에러 무시 | 문제 숨김 | Supervision 활용 |
| 순환 의존성 | 무한 루프 | TTL, 종료 조건 |

## 관련 문서

- [핵심 개념](../02-core-concepts/README.md)
- [Supervision](../04-supervision/README.md)
- [패턴 개요](./README.md)
