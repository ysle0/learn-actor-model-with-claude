/**
 * Chat Server Actor Pattern - 실시간 채팅 서버 예제 in C++
 * CAF 스타일로 구현
 *
 * 컴파일: g++ -std=c++17 chat-server.cpp -o chat-server -pthread
 */

#include <iostream>
#include <string>
#include <map>
#include <vector>
#include <memory>
#include <chrono>
#include <thread>
#include <mutex>
#include <any>
#include <sstream>

// ============================================
// 타입 정의
// ============================================

enum class UserStatus { Online, Away, Offline };

std::string statusToString(UserStatus status) {
    switch (status) {
        case UserStatus::Online: return "online";
        case UserStatus::Away: return "away";
        case UserStatus::Offline: return "offline";
        default: return "unknown";
    }
}

struct UserInfo {
    std::string userId;
    std::string username;
    UserStatus status;
    std::chrono::system_clock::time_point joinedAt;
};

struct ChatMessage {
    std::string id;
    std::string senderId;
    std::string senderName;
    std::string content;
    std::chrono::system_clock::time_point timestamp;
    std::string type; // "public", "private", "system"
};

// ============================================
// 메시지 타입
// ============================================

struct JoinRoom {
    std::string userId;
    std::string username;
};

struct LeaveRoom {
    std::string userId;
};

struct SendMessage {
    std::string userId;
    std::string content;
};

struct DirectMessage {
    std::string fromUserId;
    std::string toUserId;
    std::string content;
};

struct SetStatus {
    std::string userId;
    UserStatus status;
};

// User 세션 메시지
struct MessageReceived {
    ChatMessage message;
};

struct UserJoined {
    UserInfo user;
};

struct UserLeft {
    std::string userId;
    std::string username;
};

struct UserStatusChanged {
    std::string userId;
    UserStatus status;
};

struct RoomHistory {
    std::vector<ChatMessage> messages;
};

// ============================================
// UserSession Actor
// ============================================

class UserSessionActor {
public:
    UserSessionActor(const std::string& userId, const std::string& username)
        : sessionId_(userId), username_(username) {}

    void receive(const std::any& msg) {
        if (msg.type() == typeid(MessageReceived)) {
            auto m = std::any_cast<MessageReceived>(msg);
            messages_.push_back(m.message);
            std::string prefix = m.message.type == "private" ? "[DM] " : "";
            std::cout << "  [" << username_ << "] " << prefix
                      << m.message.senderName << ": " << m.message.content << "\n";
        }
        else if (msg.type() == typeid(UserJoined)) {
            auto m = std::any_cast<UserJoined>(msg);
            std::cout << "  [" << username_ << "] " << m.user.username << " joined\n";
        }
        else if (msg.type() == typeid(UserLeft)) {
            auto m = std::any_cast<UserLeft>(msg);
            std::cout << "  [" << username_ << "] " << m.username << " left\n";
        }
        else if (msg.type() == typeid(UserStatusChanged)) {
            auto m = std::any_cast<UserStatusChanged>(msg);
            std::cout << "  [" << username_ << "] User " << m.userId
                      << " is now " << statusToString(m.status) << "\n";
        }
        else if (msg.type() == typeid(RoomHistory)) {
            auto m = std::any_cast<RoomHistory>(msg);
            std::cout << "  [" << username_ << "] Received "
                      << m.messages.size() << " messages from history\n";
        }
    }

private:
    std::string sessionId_;
    std::string username_;
    std::vector<ChatMessage> messages_;
};

// ============================================
// ChatRoom Actor
// ============================================

class ChatRoomActor {
public:
    ChatRoomActor(const std::string& roomId, const std::string& name)
        : roomId_(roomId), name_(name), maxHistorySize_(100), msgCounter_(0) {}

    void receive(const std::any& msg) {
        std::lock_guard<std::mutex> lock(mutex_);

        if (msg.type() == typeid(JoinRoom)) {
            handleJoinRoom(std::any_cast<JoinRoom>(msg));
        }
        else if (msg.type() == typeid(LeaveRoom)) {
            handleLeaveRoom(std::any_cast<LeaveRoom>(msg));
        }
        else if (msg.type() == typeid(SendMessage)) {
            handleSendMessage(std::any_cast<SendMessage>(msg));
        }
        else if (msg.type() == typeid(DirectMessage)) {
            handleDirectMessage(std::any_cast<DirectMessage>(msg));
        }
        else if (msg.type() == typeid(SetStatus)) {
            handleSetStatus(std::any_cast<SetStatus>(msg));
        }
    }

private:
    void handleJoinRoom(const JoinRoom& m) {
        if (users_.find(m.userId) != users_.end()) {
            std::cout << "[Room " << name_ << "] " << m.username << " is already in the room\n";
            return;
        }

        UserInfo user{m.userId, m.username, UserStatus::Online, std::chrono::system_clock::now()};
        users_[m.userId] = user;

        auto session = std::make_shared<UserSessionActor>(m.userId, m.username);
        userSessions_[m.userId] = session;

        std::cout << "[Room " << name_ << "] " << m.username
                  << " joined (" << users_.size() << " users)\n";

        // 시스템 메시지
        auto sysMsg = createSystemMessage(m.username + " joined the room");
        addToHistory(sysMsg);

        // 다른 사용자들에게 알림
        broadcastToOthers(m.userId, UserJoined{user});

        // 새 사용자에게 이력 전송
        std::vector<ChatMessage> history;
        size_t start = messageHistory_.size() > 20 ? messageHistory_.size() - 20 : 0;
        for (size_t i = start; i < messageHistory_.size(); i++) {
            history.push_back(messageHistory_[i]);
        }
        session->receive(RoomHistory{history});
    }

    void handleLeaveRoom(const LeaveRoom& m) {
        auto it = users_.find(m.userId);
        if (it == users_.end()) return;

        std::string username = it->second.username;
        users_.erase(it);
        userSessions_.erase(m.userId);

        std::cout << "[Room " << name_ << "] " << username
                  << " left (" << users_.size() << " users)\n";

        auto sysMsg = createSystemMessage(username + " left the room");
        addToHistory(sysMsg);

        broadcastToAll(UserLeft{m.userId, username});
    }

    void handleSendMessage(const SendMessage& m) {
        auto it = users_.find(m.userId);
        if (it == users_.end()) return;

        ChatMessage chatMsg{
            generateId(),
            m.userId,
            it->second.username,
            m.content,
            std::chrono::system_clock::now(),
            "public"
        };

        addToHistory(chatMsg);
        std::cout << "[Room " << name_ << "] " << it->second.username << ": " << m.content << "\n";

        broadcastToAll(MessageReceived{chatMsg});
    }

    void handleDirectMessage(const DirectMessage& m) {
        auto fromIt = users_.find(m.fromUserId);
        auto toSessionIt = userSessions_.find(m.toUserId);
        auto toUserIt = users_.find(m.toUserId);

        if (fromIt == users_.end() || toSessionIt == userSessions_.end() || toUserIt == users_.end()) {
            std::cout << "[Room " << name_ << "] DM failed: user not found\n";
            return;
        }

        ChatMessage dmMsg{
            generateId(),
            m.fromUserId,
            fromIt->second.username,
            m.content,
            std::chrono::system_clock::now(),
            "private"
        };

        std::cout << "[Room " << name_ << "] DM from " << fromIt->second.username
                  << " to " << toUserIt->second.username << ": " << m.content << "\n";

        // 수신자에게 전송
        toSessionIt->second->receive(MessageReceived{dmMsg});

        // 발신자에게도 전송
        auto fromSessionIt = userSessions_.find(m.fromUserId);
        if (fromSessionIt != userSessions_.end()) {
            fromSessionIt->second->receive(MessageReceived{dmMsg});
        }
    }

    void handleSetStatus(const SetStatus& m) {
        auto it = users_.find(m.userId);
        if (it == users_.end()) return;

        it->second.status = m.status;
        std::cout << "[Room " << name_ << "] " << it->second.username
                  << " is now " << statusToString(m.status) << "\n";

        broadcastToOthers(m.userId, UserStatusChanged{m.userId, m.status});
    }

    ChatMessage createSystemMessage(const std::string& content) {
        return ChatMessage{
            generateId(),
            "system",
            "System",
            content,
            std::chrono::system_clock::now(),
            "system"
        };
    }

    void addToHistory(const ChatMessage& msg) {
        messageHistory_.push_back(msg);
        if (messageHistory_.size() > maxHistorySize_) {
            messageHistory_.erase(messageHistory_.begin());
        }
    }

    template<typename T>
    void broadcastToAll(const T& msg) {
        for (auto& [_, session] : userSessions_) {
            session->receive(msg);
        }
    }

    template<typename T>
    void broadcastToOthers(const std::string& excludeId, const T& msg) {
        for (auto& [id, session] : userSessions_) {
            if (id != excludeId) {
                session->receive(msg);
            }
        }
    }

    std::string generateId() {
        msgCounter_++;
        auto now = std::chrono::system_clock::now();
        auto timestamp = std::chrono::duration_cast<std::chrono::milliseconds>(
            now.time_since_epoch()).count();
        std::stringstream ss;
        ss << timestamp << "-" << msgCounter_;
        return ss.str();
    }

    std::string roomId_;
    std::string name_;
    std::map<std::string, UserInfo> users_;
    std::map<std::string, std::shared_ptr<UserSessionActor>> userSessions_;
    std::vector<ChatMessage> messageHistory_;
    size_t maxHistorySize_;
    long long msgCounter_;
    std::mutex mutex_;
};

// ============================================
// 메인 함수
// ============================================

int main() {
    std::cout << "=== Chat Server Actor Pattern Demo (C++) ===\n\n";

    ChatRoomActor generalRoom("general", "General");

    std::cout << "--- 1. Users Joining ---\n\n";

    generalRoom.receive(JoinRoom{"alice", "Alice"});
    std::this_thread::sleep_for(std::chrono::milliseconds(100));

    generalRoom.receive(JoinRoom{"bob", "Bob"});
    std::this_thread::sleep_for(std::chrono::milliseconds(100));

    generalRoom.receive(JoinRoom{"charlie", "Charlie"});
    std::this_thread::sleep_for(std::chrono::milliseconds(100));

    std::cout << "\n--- 2. Public Messages ---\n\n";

    generalRoom.receive(SendMessage{"alice", "Hello everyone!"});
    std::this_thread::sleep_for(std::chrono::milliseconds(100));

    generalRoom.receive(SendMessage{"bob", "Hi Alice!"});
    std::this_thread::sleep_for(std::chrono::milliseconds(100));

    generalRoom.receive(SendMessage{"charlie", "Hey all!"});
    std::this_thread::sleep_for(std::chrono::milliseconds(100));

    std::cout << "\n--- 3. Direct Messages ---\n\n";

    generalRoom.receive(DirectMessage{"alice", "bob", "Hey Bob, can we talk privately?"});
    std::this_thread::sleep_for(std::chrono::milliseconds(100));

    generalRoom.receive(DirectMessage{"bob", "alice", "Sure, what is it?"});
    std::this_thread::sleep_for(std::chrono::milliseconds(100));

    std::cout << "\n--- 4. Status Changes ---\n\n";

    generalRoom.receive(SetStatus{"charlie", UserStatus::Away});
    std::this_thread::sleep_for(std::chrono::milliseconds(100));

    std::cout << "\n--- 5. More Messages ---\n\n";

    generalRoom.receive(SendMessage{"alice", "Is Charlie still here?"});
    std::this_thread::sleep_for(std::chrono::milliseconds(100));

    generalRoom.receive(SetStatus{"charlie", UserStatus::Online});
    std::this_thread::sleep_for(std::chrono::milliseconds(100));

    generalRoom.receive(SendMessage{"charlie", "I'm back!"});
    std::this_thread::sleep_for(std::chrono::milliseconds(100));

    std::cout << "\n--- 6. User Leaving ---\n\n";

    generalRoom.receive(LeaveRoom{"bob"});
    std::this_thread::sleep_for(std::chrono::milliseconds(100));

    generalRoom.receive(SendMessage{"alice", "Bye Bob!"});
    std::this_thread::sleep_for(std::chrono::milliseconds(100));

    std::cout << "\n=== Demo Complete ===\n";

    return 0;
}
