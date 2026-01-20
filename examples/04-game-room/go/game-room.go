// Game Room Actor Pattern - 멀티플레이어 게임 룸 예제 in Go
// Proto.Actor 스타일로 구현

package main

import (
	"fmt"
	"sync"
	"time"
)

// ============================================
// 타입 정의
// ============================================

type RoomStatus string

const (
	StatusWaiting  RoomStatus = "waiting"
	StatusStarting RoomStatus = "starting"
	StatusPlaying  RoomStatus = "playing"
	StatusFinished RoomStatus = "finished"
)

type PlayerInfo struct {
	PlayerId string
	Name     string
	IsReady  bool
	Score    int
}

type RoomState struct {
	RoomId     string
	Status     RoomStatus
	Players    map[string]*PlayerInfo
	MaxPlayers int
	MinPlayers int
}

// ============================================
// 메시지 타입
// ============================================

// Room 메시지
type JoinRoom struct {
	PlayerId   string
	PlayerName string
}

type LeaveRoom struct {
	PlayerId string
}

type SetReady struct {
	PlayerId string
	Ready    bool
}

type GameAction struct {
	PlayerId   string
	ActionType string
	Points     int
}

type StartGame struct{}
type EndGame struct {
	WinnerId string
}
type GetState struct {
	Reply chan *RoomState
}

// Player 메시지
type PlayerJoined struct {
	Player *PlayerInfo
}

type PlayerLeft struct {
	PlayerId string
}

type PlayerReadyChanged struct {
	PlayerId string
	Ready    bool
}

type GameStarting struct {
	Countdown int
}

type GameStarted struct{}

type GameActionBroadcast struct {
	PlayerId   string
	ActionType string
	Points     int
}

type GameEnded struct {
	WinnerId string
	Scores   map[string]int
}

// ============================================
// Room Actor
// ============================================

type RoomActor struct {
	roomId       string
	status       RoomStatus
	players      map[string]*PlayerInfo
	playerActors map[string]*PlayerActor
	maxPlayers   int
	minPlayers   int
	mu           sync.RWMutex
}

func NewRoomActor(roomId string) *RoomActor {
	return &RoomActor{
		roomId:       roomId,
		status:       StatusWaiting,
		players:      make(map[string]*PlayerInfo),
		playerActors: make(map[string]*PlayerActor),
		maxPlayers:   4,
		minPlayers:   2,
	}
}

func (r *RoomActor) Receive(msg interface{}) {
	r.mu.Lock()
	defer r.mu.Unlock()

	switch m := msg.(type) {
	case JoinRoom:
		r.handleJoinRoom(m)
	case LeaveRoom:
		r.handleLeaveRoom(m)
	case SetReady:
		r.handleSetReady(m)
	case GameAction:
		r.handleGameAction(m)
	case StartGame:
		r.handleStartGame()
	case EndGame:
		r.handleEndGame(m)
	case GetState:
		r.handleGetState(m)
	}
}

func (r *RoomActor) handleJoinRoom(m JoinRoom) {
	if len(r.players) >= r.maxPlayers {
		fmt.Printf("[Room %s] Room is full, rejecting %s\n", r.roomId, m.PlayerName)
		return
	}

	if r.status != StatusWaiting {
		fmt.Printf("[Room %s] Game in progress, rejecting %s\n", r.roomId, m.PlayerName)
		return
	}

	player := &PlayerInfo{
		PlayerId: m.PlayerId,
		Name:     m.PlayerName,
		IsReady:  false,
		Score:    0,
	}
	r.players[m.PlayerId] = player

	playerActor := NewPlayerActor(m.PlayerId, m.PlayerName)
	r.playerActors[m.PlayerId] = playerActor

	fmt.Printf("[Room %s] %s joined (%d/%d)\n", r.roomId, m.PlayerName, len(r.players), r.maxPlayers)

	r.broadcast(m.PlayerId, PlayerJoined{Player: player})
}

func (r *RoomActor) handleLeaveRoom(m LeaveRoom) {
	player, exists := r.players[m.PlayerId]
	if !exists {
		return
	}

	delete(r.players, m.PlayerId)
	delete(r.playerActors, m.PlayerId)

	fmt.Printf("[Room %s] %s left (%d/%d)\n", r.roomId, player.Name, len(r.players), r.maxPlayers)

	r.broadcast("", PlayerLeft{PlayerId: m.PlayerId})

	if r.status == StatusPlaying && len(r.players) < r.minPlayers {
		r.status = StatusFinished
		fmt.Printf("[Room %s] Not enough players, game ended\n", r.roomId)
		r.broadcast("", GameEnded{Scores: r.getScores()})
	}

	if len(r.players) == 0 {
		r.status = StatusWaiting
		fmt.Printf("[Room %s] Room is empty, resetting\n", r.roomId)
	}
}

func (r *RoomActor) handleSetReady(m SetReady) {
	player, exists := r.players[m.PlayerId]
	if !exists || r.status != StatusWaiting {
		return
	}

	player.IsReady = m.Ready
	readyStr := "not ready"
	if m.Ready {
		readyStr = "ready"
	}
	fmt.Printf("[Room %s] %s is %s\n", r.roomId, player.Name, readyStr)

	r.broadcast("", PlayerReadyChanged{PlayerId: m.PlayerId, Ready: m.Ready})
	r.checkStartCondition()
}

func (r *RoomActor) handleGameAction(m GameAction) {
	if r.status != StatusPlaying {
		return
	}

	player, exists := r.players[m.PlayerId]
	if !exists {
		return
	}

	fmt.Printf("[Room %s] %s action: %s\n", r.roomId, player.Name, m.ActionType)

	if m.ActionType == "SCORE" {
		player.Score += m.Points
		fmt.Printf("[Room %s] %s score: %d\n", r.roomId, player.Name, player.Score)
	}

	r.broadcast("", GameActionBroadcast{
		PlayerId:   m.PlayerId,
		ActionType: m.ActionType,
		Points:     m.Points,
	})
}

func (r *RoomActor) handleStartGame() {
	if r.status != StatusWaiting {
		return
	}

	r.status = StatusStarting
	fmt.Printf("[Room %s] Game starting...\n", r.roomId)

	go func() {
		for countdown := 3; countdown > 0; countdown-- {
			r.mu.RLock()
			r.broadcast("", GameStarting{Countdown: countdown})
			r.mu.RUnlock()
			fmt.Printf("[Room %s] Starting in %d...\n", r.roomId, countdown)
			time.Sleep(time.Second)
		}

		r.mu.Lock()
		r.status = StatusPlaying
		fmt.Printf("[Room %s] Game started!\n", r.roomId)
		r.broadcast("", GameStarted{})
		r.mu.Unlock()
	}()
}

func (r *RoomActor) handleEndGame(m EndGame) {
	if r.status != StatusPlaying {
		return
	}

	r.status = StatusFinished
	winner := m.WinnerId
	if winner == "" {
		winner = "none"
	}
	fmt.Printf("[Room %s] Game ended! Winner: %s\n", r.roomId, winner)

	r.broadcast("", GameEnded{WinnerId: m.WinnerId, Scores: r.getScores()})

	go func() {
		time.Sleep(5 * time.Second)
		r.mu.Lock()
		r.status = StatusWaiting
		for _, player := range r.players {
			player.IsReady = false
			player.Score = 0
		}
		fmt.Printf("[Room %s] Room reset to waiting\n", r.roomId)
		r.mu.Unlock()
	}()
}

func (r *RoomActor) handleGetState(m GetState) {
	state := &RoomState{
		RoomId:     r.roomId,
		Status:     r.status,
		Players:    r.players,
		MaxPlayers: r.maxPlayers,
		MinPlayers: r.minPlayers,
	}
	m.Reply <- state
}

func (r *RoomActor) broadcast(excludeId string, msg interface{}) {
	for id, actor := range r.playerActors {
		if id != excludeId {
			actor.Receive(msg)
		}
	}
}

func (r *RoomActor) checkStartCondition() {
	if len(r.players) >= r.minPlayers {
		allReady := true
		for _, p := range r.players {
			if !p.IsReady {
				allReady = false
				break
			}
		}
		if allReady {
			fmt.Printf("[Room %s] All players ready!\n", r.roomId)
			go r.handleStartGame()
		}
	}
}

func (r *RoomActor) getScores() map[string]int {
	scores := make(map[string]int)
	for id, player := range r.players {
		scores[id] = player.Score
	}
	return scores
}

// ============================================
// Player Actor
// ============================================

type PlayerActor struct {
	playerId string
	name     string
}

func NewPlayerActor(playerId, name string) *PlayerActor {
	return &PlayerActor{
		playerId: playerId,
		name:     name,
	}
}

func (p *PlayerActor) Receive(msg interface{}) {
	switch m := msg.(type) {
	case PlayerJoined:
		fmt.Printf("[Player %s] %s joined the room\n", p.name, m.Player.Name)
	case PlayerLeft:
		fmt.Printf("[Player %s] Player %s left\n", p.name, m.PlayerId)
	case PlayerReadyChanged:
		readyStr := "not ready"
		if m.Ready {
			readyStr = "ready"
		}
		fmt.Printf("[Player %s] Player %s is %s\n", p.name, m.PlayerId, readyStr)
	case GameStarting:
		fmt.Printf("[Player %s] Game starting in %d...\n", p.name, m.Countdown)
	case GameStarted:
		fmt.Printf("[Player %s] Game started!\n", p.name)
	case GameActionBroadcast:
		fmt.Printf("[Player %s] Received action from %s\n", p.name, m.PlayerId)
	case GameEnded:
		winner := m.WinnerId
		if winner == "" {
			winner = "none"
		}
		fmt.Printf("[Player %s] Game ended! Winner: %s\n", p.name, winner)
	}
}

// ============================================
// 메인 함수
// ============================================

func main() {
	fmt.Println("=== Game Room Actor Pattern Demo (Go) ===\n")

	room := NewRoomActor("001")

	fmt.Println("--- 1. Players Joining ---\n")

	room.Receive(JoinRoom{PlayerId: "p1", PlayerName: "Alice"})
	time.Sleep(100 * time.Millisecond)

	room.Receive(JoinRoom{PlayerId: "p2", PlayerName: "Bob"})
	time.Sleep(100 * time.Millisecond)

	room.Receive(JoinRoom{PlayerId: "p3", PlayerName: "Charlie"})
	time.Sleep(100 * time.Millisecond)

	fmt.Println("\n--- 2. Players Getting Ready ---\n")

	room.Receive(SetReady{PlayerId: "p1", Ready: true})
	time.Sleep(100 * time.Millisecond)

	room.Receive(SetReady{PlayerId: "p2", Ready: true})
	time.Sleep(100 * time.Millisecond)

	// 마지막 플레이어가 준비되면 게임 시작
	room.Receive(SetReady{PlayerId: "p3", Ready: true})

	// 게임 시작 대기
	time.Sleep(5 * time.Second)

	fmt.Println("\n--- 3. Game Actions ---\n")

	room.Receive(GameAction{PlayerId: "p1", ActionType: "SCORE", Points: 10})
	time.Sleep(100 * time.Millisecond)

	room.Receive(GameAction{PlayerId: "p2", ActionType: "SCORE", Points: 15})
	time.Sleep(100 * time.Millisecond)

	room.Receive(GameAction{PlayerId: "p1", ActionType: "SCORE", Points: 20})
	time.Sleep(100 * time.Millisecond)

	fmt.Println("\n--- 4. Game End ---\n")

	room.Receive(EndGame{WinnerId: "p1"})
	time.Sleep(time.Second)

	fmt.Println("\n--- 5. Player Leaving ---\n")

	room.Receive(LeaveRoom{PlayerId: "p3"})
	time.Sleep(100 * time.Millisecond)

	fmt.Println("\n=== Demo Complete ===")
}
