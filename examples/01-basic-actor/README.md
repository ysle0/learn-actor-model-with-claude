# 01. Basic Actor - Counter 예제

> 가장 기본적인 Actor 패턴: 상태를 가진 Counter Actor

## 구현 목표

```
Counter Actor
─────────────
• 상태: count (정수)
• 메시지:
  - Increment: count + 1
  - Decrement: count - 1
  - GetCount: 현재 값 반환
  - Reset: 0으로 초기화
```

## 각 언어별 구현

| 언어 | 프레임워크 | 파일 |
|------|-----------|------|
| TypeScript | 직접 구현 | [typescript/](./typescript/) |
| C++ | CAF | [cpp/](./cpp/) |
| C# | Orleans | [csharp/](./csharp/) |
| Go | Proto.Actor | [go/](./go/) |

## 핵심 개념

```
┌─────────────────────────────────────────┐
│            Counter Actor                │
├─────────────────────────────────────────┤
│  State:                                 │
│    count: int = 0                       │
│                                         │
│  Behavior:                              │
│    on(Increment) → count++              │
│    on(Decrement) → count--              │
│    on(GetCount)  → return count         │
│    on(Reset)     → count = 0            │
└─────────────────────────────────────────┘
```

## 학습 포인트

1. **상태 캡슐화**: count는 오직 Actor 내부에서만 수정
2. **메시지 기반 통신**: 직접 메서드 호출 대신 메시지 전송
3. **순차 처리**: 동시에 여러 메시지가 와도 하나씩 처리
4. **Lock 불필요**: 순차 처리로 자동 스레드 안전
