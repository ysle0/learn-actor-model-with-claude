// Chat Server Actor Pattern - 실시간 채팅 서버 예제 in Go
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

type UserStatus string

const (
	StatusOnline  UserStatus = "online"
	StatusAway    UserStatus = "away"
	StatusOffline UserStatus = "offline"
)

type UserInfo struct {
	UserId   string
	Username string
	Status   UserStatus
	JoinedAt time.Time
}

type ChatMessage struct {
	Id        string
	SenderId  string
	SenderName string
	Content   string
	Timestamp time.Time
	Type      string // "public", "private", "system"
}

// ============================================
// 메시지 타입
// ============================================

type JoinRoom struct {
	UserId   string
	Username string
}

type LeaveRoom struct {
	UserId string
}

type SendMessage struct {
	UserId  string
	Content string
}

type DirectMessage struct {
	FromUserId string
	ToUserId   string
	Content    string
}

type SetStatus struct {
	UserId string
	Status UserStatus
}

// User 세션 메시지
type MessageReceived struct {
	Message ChatMessage
}

type UserJoined struct {
	User UserInfo
}

type UserLeft struct {
	UserId   string
	Username string
}

type UserStatusChanged struct {
	UserId string
	Status UserStatus
}

type RoomHistory struct {
	Messages []ChatMessage
}

// ============================================
// UserSession Actor
// ============================================

type UserSessionActor struct {
	sessionId string
	username  string
	messages  []ChatMessage
}

func NewUserSessionActor(userId, username string) *UserSessionActor {
	return &UserSessionActor{
		sessionId: userId,
		username:  username,
		messages:  make([]ChatMessage, 0),
	}
}

func (u *UserSessionActor) Receive(msg interface{}) {
	switch m := msg.(type) {
	case MessageReceived:
		u.messages = append(u.messages, m.Message)
		prefix := ""
		if m.Message.Type == "private" {
			prefix = "[DM] "
		}
		fmt.Printf("  [%s] %s%s: %s\n", u.username, prefix, m.Message.SenderName, m.Message.Content)

	case UserJoined:
		fmt.Printf("  [%s] %s joined\n", u.username, m.User.Username)

	case UserLeft:
		fmt.Printf("  [%s] %s left\n", u.username, m.Username)

	case UserStatusChanged:
		fmt.Printf("  [%s] User %s is now %s\n", u.username, m.UserId, m.Status)

	case RoomHistory:
		fmt.Printf("  [%s] Received %d messages from history\n", u.username, len(m.Messages))
	}
}

// ============================================
// ChatRoom Actor
// ============================================

type ChatRoomActor struct {
	roomId         string
	name           string
	users          map[string]*UserInfo
	userSessions   map[string]*UserSessionActor
	messageHistory []ChatMessage
	maxHistorySize int
	mu             sync.RWMutex
	msgCounter     int64
}

func NewChatRoomActor(roomId, name string) *ChatRoomActor {
	return &ChatRoomActor{
		roomId:         roomId,
		name:           name,
		users:          make(map[string]*UserInfo),
		userSessions:   make(map[string]*UserSessionActor),
		messageHistory: make([]ChatMessage, 0),
		maxHistorySize: 100,
	}
}

func (c *ChatRoomActor) Receive(msg interface{}) {
	c.mu.Lock()
	defer c.mu.Unlock()

	switch m := msg.(type) {
	case JoinRoom:
		c.handleJoinRoom(m)
	case LeaveRoom:
		c.handleLeaveRoom(m)
	case SendMessage:
		c.handleSendMessage(m)
	case DirectMessage:
		c.handleDirectMessage(m)
	case SetStatus:
		c.handleSetStatus(m)
	}
}

func (c *ChatRoomActor) handleJoinRoom(m JoinRoom) {
	if _, exists := c.users[m.UserId]; exists {
		fmt.Printf("[Room %s] %s is already in the room\n", c.name, m.Username)
		return
	}

	user := &UserInfo{
		UserId:   m.UserId,
		Username: m.Username,
		Status:   StatusOnline,
		JoinedAt: time.Now(),
	}
	c.users[m.UserId] = user

	session := NewUserSessionActor(m.UserId, m.Username)
	c.userSessions[m.UserId] = session

	fmt.Printf("[Room %s] %s joined (%d users)\n", c.name, m.Username, len(c.users))

	// 시스템 메시지
	sysMsg := c.createSystemMessage(fmt.Sprintf("%s joined the room", m.Username))
	c.addToHistory(sysMsg)

	// 다른 사용자들에게 알림
	c.broadcastToOthers(m.UserId, UserJoined{User: *user})

	// 새 사용자에게 이력 전송
	historyStart := 0
	if len(c.messageHistory) > 20 {
		historyStart = len(c.messageHistory) - 20
	}
	session.Receive(RoomHistory{Messages: c.messageHistory[historyStart:]})
}

func (c *ChatRoomActor) handleLeaveRoom(m LeaveRoom) {
	user, exists := c.users[m.UserId]
	if !exists {
		return
	}

	delete(c.users, m.UserId)
	delete(c.userSessions, m.UserId)

	fmt.Printf("[Room %s] %s left (%d users)\n", c.name, user.Username, len(c.users))

	sysMsg := c.createSystemMessage(fmt.Sprintf("%s left the room", user.Username))
	c.addToHistory(sysMsg)

	c.broadcastToAll(UserLeft{UserId: m.UserId, Username: user.Username})
}

func (c *ChatRoomActor) handleSendMessage(m SendMessage) {
	user, exists := c.users[m.UserId]
	if !exists {
		return
	}

	chatMsg := ChatMessage{
		Id:         c.generateId(),
		SenderId:   m.UserId,
		SenderName: user.Username,
		Content:    m.Content,
		Timestamp:  time.Now(),
		Type:       "public",
	}

	c.addToHistory(chatMsg)
	fmt.Printf("[Room %s] %s: %s\n", c.name, user.Username, m.Content)

	c.broadcastToAll(MessageReceived{Message: chatMsg})
}

func (c *ChatRoomActor) handleDirectMessage(m DirectMessage) {
	fromUser, fromExists := c.users[m.FromUserId]
	toSession, toExists := c.userSessions[m.ToUserId]
	toUser := c.users[m.ToUserId]

	if !fromExists || !toExists || toUser == nil {
		fmt.Printf("[Room %s] DM failed: user not found\n", c.name)
		return
	}

	dmMsg := ChatMessage{
		Id:         c.generateId(),
		SenderId:   m.FromUserId,
		SenderName: fromUser.Username,
		Content:    m.Content,
		Timestamp:  time.Now(),
		Type:       "private",
	}

	fmt.Printf("[Room %s] DM from %s to %s: %s\n", c.name, fromUser.Username, toUser.Username, m.Content)

	// 수신자에게 전송
	toSession.Receive(MessageReceived{Message: dmMsg})

	// 발신자에게도 전송
	if fromSession, ok := c.userSessions[m.FromUserId]; ok {
		fromSession.Receive(MessageReceived{Message: dmMsg})
	}
}

func (c *ChatRoomActor) handleSetStatus(m SetStatus) {
	user, exists := c.users[m.UserId]
	if !exists {
		return
	}

	user.Status = m.Status
	fmt.Printf("[Room %s] %s is now %s\n", c.name, user.Username, m.Status)

	c.broadcastToOthers(m.UserId, UserStatusChanged{UserId: m.UserId, Status: m.Status})
}

func (c *ChatRoomActor) createSystemMessage(content string) ChatMessage {
	return ChatMessage{
		Id:         c.generateId(),
		SenderId:   "system",
		SenderName: "System",
		Content:    content,
		Timestamp:  time.Now(),
		Type:       "system",
	}
}

func (c *ChatRoomActor) addToHistory(msg ChatMessage) {
	c.messageHistory = append(c.messageHistory, msg)
	if len(c.messageHistory) > c.maxHistorySize {
		c.messageHistory = c.messageHistory[1:]
	}
}

func (c *ChatRoomActor) broadcastToAll(msg interface{}) {
	for _, session := range c.userSessions {
		session.Receive(msg)
	}
}

func (c *ChatRoomActor) broadcastToOthers(excludeId string, msg interface{}) {
	for id, session := range c.userSessions {
		if id != excludeId {
			session.Receive(msg)
		}
	}
}

func (c *ChatRoomActor) generateId() string {
	c.msgCounter++
	return fmt.Sprintf("%d-%d", time.Now().UnixNano(), c.msgCounter)
}

// ============================================
// 메인 함수
// ============================================

func main() {
	fmt.Println("=== Chat Server Actor Pattern Demo (Go) ===\n")

	generalRoom := NewChatRoomActor("general", "General")

	fmt.Println("--- 1. Users Joining ---\n")

	generalRoom.Receive(JoinRoom{UserId: "alice", Username: "Alice"})
	time.Sleep(100 * time.Millisecond)

	generalRoom.Receive(JoinRoom{UserId: "bob", Username: "Bob"})
	time.Sleep(100 * time.Millisecond)

	generalRoom.Receive(JoinRoom{UserId: "charlie", Username: "Charlie"})
	time.Sleep(100 * time.Millisecond)

	fmt.Println("\n--- 2. Public Messages ---\n")

	generalRoom.Receive(SendMessage{UserId: "alice", Content: "Hello everyone!"})
	time.Sleep(100 * time.Millisecond)

	generalRoom.Receive(SendMessage{UserId: "bob", Content: "Hi Alice!"})
	time.Sleep(100 * time.Millisecond)

	generalRoom.Receive(SendMessage{UserId: "charlie", Content: "Hey all!"})
	time.Sleep(100 * time.Millisecond)

	fmt.Println("\n--- 3. Direct Messages ---\n")

	generalRoom.Receive(DirectMessage{
		FromUserId: "alice",
		ToUserId:   "bob",
		Content:    "Hey Bob, can we talk privately?",
	})
	time.Sleep(100 * time.Millisecond)

	generalRoom.Receive(DirectMessage{
		FromUserId: "bob",
		ToUserId:   "alice",
		Content:    "Sure, what is it?",
	})
	time.Sleep(100 * time.Millisecond)

	fmt.Println("\n--- 4. Status Changes ---\n")

	generalRoom.Receive(SetStatus{UserId: "charlie", Status: StatusAway})
	time.Sleep(100 * time.Millisecond)

	fmt.Println("\n--- 5. More Messages ---\n")

	generalRoom.Receive(SendMessage{UserId: "alice", Content: "Is Charlie still here?"})
	time.Sleep(100 * time.Millisecond)

	generalRoom.Receive(SetStatus{UserId: "charlie", Status: StatusOnline})
	time.Sleep(100 * time.Millisecond)

	generalRoom.Receive(SendMessage{UserId: "charlie", Content: "I'm back!"})
	time.Sleep(100 * time.Millisecond)

	fmt.Println("\n--- 6. User Leaving ---\n")

	generalRoom.Receive(LeaveRoom{UserId: "bob"})
	time.Sleep(100 * time.Millisecond)

	generalRoom.Receive(SendMessage{UserId: "alice", Content: "Bye Bob!"})
	time.Sleep(100 * time.Millisecond)

	fmt.Println("\n=== Demo Complete ===")
}
