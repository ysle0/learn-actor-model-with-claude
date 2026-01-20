# 02. Message Passing - 메시지 패싱 패턴

> Actor 간 통신의 핵심 패턴: Tell, Ask, Forward

## 구현 목표

```
Message Passing Patterns
────────────────────────
• Tell (Fire-and-Forget): 응답 없이 메시지 전송
• Ask (Request-Response): 응답 대기 메시지 전송
• Forward: 메시지를 다른 Actor에게 전달
• Broadcast: 여러 Actor에게 동시 전송
```

## 각 언어별 구현

| 언어 | 프레임워크 | 파일 |
|------|-----------|------|
| TypeScript | 직접 구현 | [typescript/](./typescript/) |
| C++ | CAF | [cpp/](./cpp/) |
| C# | Orleans | [csharp/](./csharp/) |
| Go | Proto.Actor | [go/](./go/) |

## 시나리오: 주문 처리 시스템

```
┌─────────────────────────────────────────────────────────────────┐
│                    주문 처리 흐름                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Client                                                         │
│    │                                                            │
│    │ Ask(CreateOrder)                                           │
│    ▼                                                            │
│  ┌─────────────┐  Tell(ValidatePayment)  ┌─────────────┐       │
│  │ OrderActor  │ ────────────────────────▶ │ PaymentActor│       │
│  └──────┬──────┘                          └──────┬──────┘       │
│         │                                        │               │
│         │ Forward(ShipOrder)                     │               │
│         ▼                                        │               │
│  ┌─────────────┐  Tell(PaymentComplete)          │              │
│  │ShippingActor│ ◀───────────────────────────────┘              │
│  └─────────────┘                                                │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## 핵심 개념

### 1. Tell (Fire-and-Forget)

```
┌─────────┐  message   ┌─────────┐
│ Actor A │ ──────────▶ │ Actor B │
└─────────┘            └─────────┘
     │
     └─ 즉시 반환 (응답 안 기다림)
```

### 2. Ask (Request-Response)

```
┌─────────┐  request   ┌─────────┐
│ Actor A │ ──────────▶ │ Actor B │
└─────────┘            └────┬────┘
     ▲                      │
     │      response        │
     └──────────────────────┘
```

### 3. Forward

```
┌─────────┐  message   ┌─────────┐  forward   ┌─────────┐
│ Actor A │ ──────────▶ │ Actor B │ ──────────▶ │ Actor C │
└─────────┘            └─────────┘            └────┬────┘
     ▲                                             │
     │              response (직접)                │
     └─────────────────────────────────────────────┘
```

## 학습 포인트

1. **Tell vs Ask**: Tell은 비동기적이고 빠름, Ask는 응답이 필요할 때
2. **메시지 불변성**: 메시지는 전송 후 변경하면 안 됨
3. **순환 대기 주의**: Ask 패턴 사용 시 데드락 가능성
4. **Forward 패턴**: 원래 sender 정보 유지하며 전달

## 실행 방법

### TypeScript
```bash
cd typescript
npx ts-node message-passing.ts
```

### Go
```bash
cd go
go run message-passing.go
```

### C#
```bash
cd csharp
dotnet run
```

### C++
```bash
cd cpp
# CAF 라이브러리 필요
g++ -std=c++17 message-passing.cpp -lcaf_core -o message-passing
./message-passing
```
