// Supervision Pattern - 감독 트리 예제 in Go
// Proto.Actor 스타일로 구현

package main

import (
	"errors"
	"fmt"
	"math/rand"
	"sync"
	"time"
)

// ============================================
// 감독 전략 정의
// ============================================

type Directive int

const (
	ResumeDirective Directive = iota
	RestartDirective
	StopDirective
	EscalateDirective
)

func (d Directive) String() string {
	switch d {
	case ResumeDirective:
		return "RESUME"
	case RestartDirective:
		return "RESTART"
	case StopDirective:
		return "STOP"
	case EscalateDirective:
		return "ESCALATE"
	default:
		return "UNKNOWN"
	}
}

type Decider func(error) Directive

type SupervisorStrategy struct {
	Type       string // "one-for-one" or "all-for-one"
	MaxRetries int
	WithinMs   int64
	Decider    Decider
}

// ============================================
// 재시작 통계
// ============================================

type RestartStatistics struct {
	failures   []int64
	maxRetries int
	withinMs   int64
	mu         sync.Mutex
}

func NewRestartStatistics(maxRetries int, withinMs int64) *RestartStatistics {
	return &RestartStatistics{
		failures:   make([]int64, 0),
		maxRetries: maxRetries,
		withinMs:   withinMs,
	}
}

func (rs *RestartStatistics) RecordFailure() bool {
	rs.mu.Lock()
	defer rs.mu.Unlock()

	now := time.Now().UnixMilli()
	rs.failures = append(rs.failures, now)

	// 시간 범위 내의 실패만 유지
	filtered := make([]int64, 0)
	for _, t := range rs.failures {
		if now-t < rs.withinMs {
			filtered = append(filtered, t)
		}
	}
	rs.failures = filtered

	return len(rs.failures) <= rs.maxRetries
}

func (rs *RestartStatistics) Reset() {
	rs.mu.Lock()
	defer rs.mu.Unlock()
	rs.failures = make([]int64, 0)
}

// ============================================
// 에러 타입 정의
// ============================================

type TransientError struct {
	Message string
}

func (e *TransientError) Error() string {
	return e.Message
}

type DatabaseError struct {
	Message string
}

func (e *DatabaseError) Error() string {
	return e.Message
}

type FatalError struct {
	Message string
}

func (e *FatalError) Error() string {
	return e.Message
}

// ============================================
// Actor 인터페이스
// ============================================

type Actor interface {
	Receive(msg interface{}) error
	PreStart()
	PostStop()
	PreRestart(reason error)
	PostRestart(reason error)
	SetParent(parent *SupervisedActor)
	GetName() string
	Stop()
	IsRunning() bool
}

// ============================================
// 감독 Actor 베이스
// ============================================

type SupervisedActor struct {
	name         string
	children     map[string]Actor
	parent       *SupervisedActor
	strategy     *SupervisorStrategy
	restartStats map[string]*RestartStatistics
	running      bool
	mu           sync.RWMutex
}

func NewSupervisedActor(name string, strategy *SupervisorStrategy) *SupervisedActor {
	return &SupervisedActor{
		name:         name,
		children:     make(map[string]Actor),
		strategy:     strategy,
		restartStats: make(map[string]*RestartStatistics),
		running:      true,
	}
}

func (a *SupervisedActor) GetName() string {
	return a.name
}

func (a *SupervisedActor) IsRunning() bool {
	a.mu.RLock()
	defer a.mu.RUnlock()
	return a.running
}

func (a *SupervisedActor) SetParent(parent *SupervisedActor) {
	a.parent = parent
}

func (a *SupervisedActor) Spawn(name string, child Actor) Actor {
	a.mu.Lock()
	defer a.mu.Unlock()

	child.SetParent(a)
	a.children[name] = child

	if a.strategy != nil {
		a.restartStats[name] = NewRestartStatistics(a.strategy.MaxRetries, a.strategy.WithinMs)
	}

	fmt.Printf("[%s] Spawned child: %s\n", a.name, name)
	child.PreStart()
	return child
}

func (a *SupervisedActor) Send(msg interface{}) {
	if !a.IsRunning() {
		fmt.Printf("[%s] Actor is stopped, message dropped\n", a.name)
		return
	}

	if err := a.Receive(msg); err != nil {
		a.HandleFailure(err, msg)
	}
}

func (a *SupervisedActor) Receive(msg interface{}) error {
	fmt.Printf("[%s] Received: %v\n", a.name, msg)
	return nil
}

func (a *SupervisedActor) PreStart() {
	fmt.Printf("[%s] Starting...\n", a.name)
}

func (a *SupervisedActor) PostStop() {
	fmt.Printf("[%s] Stopped\n", a.name)
}

func (a *SupervisedActor) PreRestart(reason error) {
	fmt.Printf("[%s] Restarting due to: %s\n", a.name, reason.Error())
	for _, child := range a.children {
		child.Stop()
	}
	a.PostStop()
}

func (a *SupervisedActor) PostRestart(reason error) {
	a.PreStart()
	fmt.Printf("[%s] Restarted\n", a.name)
}

func (a *SupervisedActor) HandleFailure(err error, msg interface{}) {
	fmt.Printf("[%s] Failed with: %s\n", a.name, err.Error())

	if a.parent != nil {
		a.parent.Supervise(a.name, err, msg)
	} else {
		fmt.Printf("[%s] Root actor failure\n", a.name)
		a.Stop()
	}
}

func (a *SupervisedActor) Supervise(childName string, err error, msg interface{}) {
	a.mu.Lock()
	child, exists := a.children[childName]
	strategy := a.strategy
	a.mu.Unlock()

	if !exists || strategy == nil {
		return
	}

	directive := strategy.Decider(err)
	fmt.Printf("[%s] Supervising %s: %s\n", a.name, childName, directive)

	switch directive {
	case ResumeDirective:
		fmt.Printf("[%s] Resuming %s\n", a.name, childName)

	case RestartDirective:
		a.handleRestart(childName, child, err)

	case StopDirective:
		a.handleStop(childName, child)

	case EscalateDirective:
		if a.parent != nil {
			a.parent.Supervise(a.name, err, msg)
		}
	}
}

func (a *SupervisedActor) handleRestart(childName string, child Actor, err error) {
	a.mu.Lock()
	stats := a.restartStats[childName]
	strategy := a.strategy
	a.mu.Unlock()

	if stats != nil && !stats.RecordFailure() {
		fmt.Printf("[%s] Max retries exceeded for %s, stopping\n", a.name, childName)
		a.handleStop(childName, child)
		return
	}

	if strategy != nil && strategy.Type == "all-for-one" {
		fmt.Printf("[%s] All-for-one: restarting all children\n", a.name)
		a.mu.RLock()
		for _, c := range a.children {
			c.PreRestart(err)
			c.PostRestart(err)
		}
		a.mu.RUnlock()
	} else {
		child.PreRestart(err)
		child.PostRestart(err)
	}
}

func (a *SupervisedActor) handleStop(childName string, child Actor) {
	child.Stop()
	a.mu.Lock()
	delete(a.children, childName)
	delete(a.restartStats, childName)
	a.mu.Unlock()
}

func (a *SupervisedActor) Stop() {
	a.mu.Lock()
	a.running = false
	children := make([]Actor, 0, len(a.children))
	for _, child := range a.children {
		children = append(children, child)
	}
	a.children = make(map[string]Actor)
	a.mu.Unlock()

	for _, child := range children {
		child.Stop()
	}
	a.PostStop()
}

// ============================================
// Worker Actor
// ============================================

type WorkerActor struct {
	*SupervisedActor
	jobCount int
}

func NewWorkerActor(name string) *WorkerActor {
	return &WorkerActor{
		SupervisedActor: NewSupervisedActor(name, nil),
		jobCount:        0,
	}
}

func (w *WorkerActor) Receive(msg interface{}) error {
	switch m := msg.(type) {
	case map[string]interface{}:
		if m["type"] == "PROCESS_JOB" {
			w.jobCount++
			data := m["data"].(string)
			fmt.Printf("[%s] Processing job #%d: %s\n", w.name, w.jobCount, data)

			if data == "transient_error" {
				return &TransientError{Message: "Temporary network issue"}
			}
			if data == "fatal_error" {
				return &FatalError{Message: "Critical system failure"}
			}

			fmt.Printf("[%s] Job #%d completed\n", w.name, w.jobCount)
		}
	}
	return nil
}

func (w *WorkerActor) PreRestart(reason error) {
	fmt.Printf("[%s] Saving state before restart... (jobs processed: %d)\n", w.name, w.jobCount)
	w.SupervisedActor.PreRestart(reason)
}

func (w *WorkerActor) PostRestart(reason error) {
	w.jobCount = 0
	w.SupervisedActor.PostRestart(reason)
}

// ============================================
// Database Actor
// ============================================

type DatabaseActor struct {
	*SupervisedActor
	connectionPool int
}

func NewDatabaseActor(name string) *DatabaseActor {
	return &DatabaseActor{
		SupervisedActor: NewSupervisedActor(name, nil),
		connectionPool:  5,
	}
}

func (d *DatabaseActor) Receive(msg interface{}) error {
	switch m := msg.(type) {
	case map[string]interface{}:
		if m["type"] == "QUERY" {
			sql := m["sql"].(string)
			fmt.Printf("[%s] Executing query: %s\n", d.name, sql)

			if sql == "bad_query" {
				return &DatabaseError{Message: "Query syntax error"}
			}

			fmt.Printf("[%s] Query completed\n", d.name)
		}
	}
	return nil
}

func (d *DatabaseActor) PreRestart(reason error) {
	fmt.Printf("[%s] Keeping connection pool: %d\n", d.name, d.connectionPool)
}

// ============================================
// Worker Supervisor
// ============================================

type WorkerSupervisor struct {
	*SupervisedActor
}

func NewWorkerSupervisor() *WorkerSupervisor {
	strategy := &SupervisorStrategy{
		Type:       "one-for-one",
		MaxRetries: 3,
		WithinMs:   60000,
		Decider: func(err error) Directive {
			switch err.(type) {
			case *TransientError:
				return RestartDirective
			case *FatalError:
				return StopDirective
			default:
				return EscalateDirective
			}
		},
	}
	return &WorkerSupervisor{
		SupervisedActor: NewSupervisedActor("WorkerSupervisor", strategy),
	}
}

func (ws *WorkerSupervisor) Receive(msg interface{}) error {
	switch m := msg.(type) {
	case map[string]interface{}:
		if m["type"] == "DISPATCH" {
			ws.mu.RLock()
			workers := make([]Actor, 0, len(ws.children))
			for _, child := range ws.children {
				workers = append(workers, child)
			}
			ws.mu.RUnlock()

			if len(workers) > 0 {
				worker := workers[rand.Intn(len(workers))]
				if w, ok := worker.(*WorkerActor); ok {
					if err := w.Receive(map[string]interface{}{
						"type": "PROCESS_JOB",
						"data": m["data"],
					}); err != nil {
						ws.Supervise(worker.GetName(), err, msg)
					}
				}
			}
		}
	}
	return nil
}

func (ws *WorkerSupervisor) InitWorkers(count int) {
	for i := 1; i <= count; i++ {
		name := fmt.Sprintf("Worker-%d", i)
		ws.Spawn(name, NewWorkerActor(name))
	}
}

// ============================================
// Root Supervisor
// ============================================

type RootSupervisor struct {
	*SupervisedActor
}

func NewRootSupervisor() *RootSupervisor {
	strategy := &SupervisorStrategy{
		Type:       "one-for-one",
		MaxRetries: 5,
		WithinMs:   60000,
		Decider: func(err error) Directive {
			fmt.Printf("[RootSupervisor] Deciding for error type\n")
			switch err.(type) {
			case *DatabaseError:
				return ResumeDirective
			default:
				return RestartDirective
			}
		},
	}
	return &RootSupervisor{
		SupervisedActor: NewSupervisedActor("RootSupervisor", strategy),
	}
}

// ============================================
// 메인 함수
// ============================================

func main() {
	fmt.Println("=== Supervision Pattern Demo (Go) ===\n")

	rand.Seed(time.Now().UnixNano())

	// 감독 트리 구성
	root := NewRootSupervisor()
	root.PreStart()

	workerSupervisor := NewWorkerSupervisor()
	root.Spawn("WorkerSupervisor", workerSupervisor)

	database := NewDatabaseActor("Database")
	root.Spawn("Database", database)

	// 워커 초기화
	workerSupervisor.InitWorkers(3)

	fmt.Println("\n--- 1. Normal Operation ---\n")

	workerSupervisor.Receive(map[string]interface{}{"type": "DISPATCH", "data": "job-1"})
	workerSupervisor.Receive(map[string]interface{}{"type": "DISPATCH", "data": "job-2"})
	database.Receive(map[string]interface{}{"type": "QUERY", "sql": "SELECT * FROM users"})

	time.Sleep(100 * time.Millisecond)

	fmt.Println("\n--- 2. Transient Error (Restart) ---\n")

	workerSupervisor.Receive(map[string]interface{}{"type": "DISPATCH", "data": "transient_error"})

	time.Sleep(100 * time.Millisecond)

	fmt.Println("\n--- 3. Database Error (Resume) ---\n")

	if err := database.Receive(map[string]interface{}{"type": "QUERY", "sql": "bad_query"}); err != nil {
		root.Supervise("Database", err, nil)
	}

	time.Sleep(100 * time.Millisecond)

	fmt.Println("\n--- 4. Normal Operation After Recovery ---\n")

	workerSupervisor.Receive(map[string]interface{}{"type": "DISPATCH", "data": "job-3"})
	database.Receive(map[string]interface{}{"type": "QUERY", "sql": "SELECT * FROM orders"})

	time.Sleep(100 * time.Millisecond)

	fmt.Println("\n--- 5. Fatal Error (Stop) ---\n")

	workerSupervisor.Receive(map[string]interface{}{"type": "DISPATCH", "data": "fatal_error"})

	time.Sleep(100 * time.Millisecond)

	fmt.Println("\n--- 6. System Shutdown ---\n")

	root.Stop()

	fmt.Println("\n=== Demo Complete ===")
}
