# 03. Supervision - 감독 트리 패턴

> Actor 장애 처리의 핵심: 계층적 감독과 복구 전략

## 구현 목표

```
Supervision Strategies
──────────────────────
• One-For-One: 실패한 자식만 처리
• All-For-One: 한 자식 실패 시 모든 자식 처리
• Restart: Actor 재시작 (상태 초기화)
• Resume: 계속 진행 (상태 유지)
• Stop: Actor 종료
• Escalate: 부모에게 에스컬레이션
```

## 각 언어별 구현

| 언어 | 프레임워크 | 파일 |
|------|-----------|------|
| TypeScript | 직접 구현 | [typescript/](./typescript/) |
| C++ | CAF 스타일 | [cpp/](./cpp/) |
| C# | Orleans 스타일 | [csharp/](./csharp/) |
| Go | Proto.Actor 스타일 | [go/](./go/) |

## 시나리오: 작업 처리 시스템

```
┌─────────────────────────────────────────────────────────────────┐
│                    감독 트리 구조                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│                    ┌─────────────────┐                         │
│                    │  RootSupervisor │                         │
│                    │  (Escalate)     │                         │
│                    └────────┬────────┘                         │
│                             │                                   │
│              ┌──────────────┼──────────────┐                   │
│              │              │              │                    │
│     ┌────────▼────────┐ ┌───▼────┐ ┌──────▼──────┐            │
│     │ WorkerSupervisor│ │Database│ │ Network     │            │
│     │ (One-For-One)   │ │(Resume)│ │ (Restart)   │            │
│     └────────┬────────┘ └────────┘ └─────────────┘            │
│              │                                                  │
│    ┌─────────┼─────────┐                                       │
│    │         │         │                                        │
│  ┌─▼──┐   ┌──▼─┐   ┌──▼─┐                                     │
│  │ W1 │   │ W2 │   │ W3 │  Worker Actors                      │
│  └────┘   └────┘   └────┘                                      │
│                                                                 │
│  장애 발생 시:                                                  │
│  ─────────────                                                  │
│  W2 실패 → WorkerSupervisor가 W2만 Restart                     │
│  Database 실패 → Resume (상태 유지하고 계속)                   │
│  Network 실패 → Restart (재연결)                               │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## 핵심 개념

### 1. One-For-One 전략

```
부모 Actor
    │
    ├─ 자식1 (정상)
    ├─ 자식2 (실패!) → 자식2만 재시작
    └─ 자식3 (정상)
```

### 2. All-For-One 전략

```
부모 Actor
    │
    ├─ 자식1 (정상) → 재시작
    ├─ 자식2 (실패!) → 재시작 (원인)
    └─ 자식3 (정상) → 재시작
```

### 3. 재시작 제한

```
┌─────────────────────────────────────────┐
│  RestartStatistics                      │
├─────────────────────────────────────────┤
│  maxRetries: 3                          │
│  withinDuration: 1분                    │
│                                         │
│  1분 내 3번 재시작 실패 → Stop          │
└─────────────────────────────────────────┘
```

## 학습 포인트

1. **Let it crash**: 방어적 코딩 대신 장애 허용
2. **계층적 복구**: 각 레벨에서 적절한 전략 적용
3. **상태 관리**: Restart vs Resume 선택 기준
4. **에스컬레이션**: 처리 불가능한 장애 전파

## 실행 방법

### TypeScript
```bash
cd typescript
npx ts-node supervision.ts
```

### Go
```bash
cd go
go run supervision.go
```

### C#
```bash
cd csharp
dotnet run
```

### C++
```bash
cd cpp
g++ -std=c++17 supervision.cpp -o supervision
./supervision
```
