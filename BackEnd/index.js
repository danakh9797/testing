const express = require("express");
const { instrument } = require("@socket.io/admin-ui");
const app = express();
const cors = require("cors");
const http = require("http").Server(app);
const socketIO = require("socket.io")(http, { maxHttpBufferSize: 1e8 });
const mongoose = require("mongoose");
const userRoutes = require("./routes/userRoutes");
const User = require("./models/userModel");
const Chat = require("./models/chatModel");
const OneSignal = require("onesignal-node");
const Agenda = require("agenda");
const fs = require("node:fs");
const path = require("node:path");
const { Stream } = require("stream");

const PORT = 4000;

async function sendNotification(
  title,
  message,
  externalIds,
  sender_id,
  conversation_id,
  conversation_name,
  time
) {
  const client = new OneSignal.Client(
    "7357ca70-18ed-4c5e-90ac-5243b6e24d24",
    "NTQzODdlY2EtY2YxNi00MGI0LTg0NzEtZWI5YmM4OTUxY2Vj"
  );
  const notification = {
    contents: { en: message },
    headings: { en: title },
    include_external_user_ids: externalIds,
    data: {
      sender: title,
      sender_id: sender_id,
      conversation_id: conversation_id,
      conversation_name: conversation_name,
      time: time,
    },
    android_group: "alkhademmessenger",
  };
  try {
    const response = await client.createNotification(notification);
    console.log("Notification sent:", response.body);
    return response.body;
  } catch (error) {
    console.error("Error sending notification:", error);
  }
}

const uri1 =
  "mongodb+srv://danokhkh:31ccu3cNAEPCqlCu@cluster0.efhqbnr.mongodb.net/";
const uri2 =
  "mongodb+srv://mu7amadalda7ik:mb7RWcdpBRqCUM3V@cluster0.o5nv3mi.mongodb.net/";

mongoose
  .connect(uri1)
  .then(() => {
    console.log("DB connection successful");
  })
  .catch((err) => {
    console.log(err.message);
  });

const agenda = new Agenda({ db: { address: uri1, collection: "agendaJobs" } });

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cors());

const userLocations = {};

app.post("/update-location", (req, res) => {
  const { userId, latitude, longitude } = req.body;
  userLocations[userId] = { latitude, longitude, timestamp: new Date() };
  console.log(userLocations);
  res.sendStatus(200);
});

app.get("/locations", (req, res) => {
  console.log("locations");
  res.json(userLocations);
});

app.use("/auth", userRoutes);

const arrayIncludesObject = (array, key, value) => {
  let index = array.findIndex((element) => {
    return element[key] === value;
  });
  if (index === -1) {
    return false;
  } else {
    return true;
  }
};

socketIO.on("connection", (socket) => {
  console.log("connected " + socket.id);

  socket.on("join", (userId) => {
    socket.join(userId);
    console.log("joined " + userId);
  });

  socket.on("createGroup", async (newGroupDb) => {
    const groupMembers = await User.find({ _id: { $in: newGroupDb.members } });
    const newGroup = new Chat({
      groupId: newGroupDb.conversation_id,
      groupName: newGroupDb.conversation_name,
      members: groupMembers,
    });

    newGroup
      .save()
      .then(async () => {
        socketIO.sockets.in(newGroupDb.members).emit("newGroup", newGroup);
        const externalIds = newGroupDb.members;
        await sendNotification("New group", newGroup.groupName, externalIds);
      })
      .catch((err) => {
        console.error("Error creating group:", err);
      });
  });

  const storeWaitingGroup = async (newGroupDb) => {
    await newGroupDb.members.forEach((member) => {
      User.findOne({ _id: member }).then((user) => {
        if (user.connectId === "") {
          user.groupsCommands.push({
            conversation_id: newGroupDb.conversation_id,
          });
          user.save();
        }
      });
    });
  };

  socket.on("createGroup", storeWaitingGroup);

  socket.on("addMembers", async (newMembers) => {
    const existedGroup = await Chat.findOne({ _id: newMembers.group_id });
    const newGroupMembers = await User.find({
      _id: { $in: newMembers.newMembers },
    });
    // console.log(newGroupMembers);
    await Chat.findOneAndUpdate(
      { _id: newMembers.group_id },
      { $addToSet: { members: { $each: newGroupMembers } } },
      { new: true }
    )
      .populate("members")
      .then(async (chat) => {
        console.log(chat);
        if (newMembers.newMembers.length > 0) {
          socketIO.sockets.in(newMembers.newMembers).emit("addToGroup", chat);
          const externalIds = newMembers.newMembers;
          await sendNotification("Added to group", chat.groupName, externalIds);
        }
      });
    const AddedGroupMembers = {
      group_id: newMembers.group_id,
      newMembers: newGroupMembers,
    };
    socketIO.sockets
      .in(existedGroup.members.map((objectId) => objectId.toString()))
      .emit("addGroupMembers", AddedGroupMembers);
  });

  const storeWaitingNewGroupMembers = async (newMembers) => {
    await Chat.findOne({ _id: newMembers.group_id })
      .populate("members")
      .then(async (chat) => {
        chat.members.forEach(async (user) => {
          await User.findOne({ _id: user._id }).then((user) => {
            if (user.connectId === "") {
              if (
                arrayIncludesObject(
                  user.groupsCommands,
                  "groupId",
                  newMembers.group_id
                )
              ) {
                return;
              } else if (
                arrayIncludesObject(
                  user.groupsCommands,
                  "conversation_id",
                  chat.groupId
                )
              ) {
                return;
              } else {
                user.groupsCommands.push(newMembers);
                user.save();
              }
            }
          });
        });
        User.find({ _id: { $in: newMembers.newMembers } }).then((users) => {
          users.forEach((user) => {
            if (user.connectId === "") {
              user.groupsCommands.push({
                groupId: newMembers.group_id,
              });
              user.save();
            }
          });
        });
      });
  };

  socket.on("addMembers", storeWaitingNewGroupMembers);

  const deleteMember = async (deletedMember) => {
    const existedGroup = await Chat.findOne({ _id: deletedMember.group_id });
    const editedGroup = await Chat.findOneAndUpdate(
      { _id: deletedMember.group_id },
      { $pull: { members: deletedMember.deletedMember } },
      { new: true }
    );
    socketIO.sockets
      .in(existedGroup.members.map((objectId) => objectId.toString()))
      .emit("deleteGroupMembers", deletedMember);
    console.log(editedGroup);
  };

  const storeWaitingDeletedGroupMembers = async (deletedMember) => {
    await Chat.findOne({ _id: deletedMember.group_id })
      .populate("members")
      .then((chat) => {
        chat.members.forEach((member) => {
          User.findOne({ _id: member._id }).then((user) => {
            if (user.connectId === "") {
              if (
                arrayIncludesObject(
                  user.groupsCommands,
                  "groupId",
                  deletedMember.group_id
                )
              ) {
                return;
              } else if (
                arrayIncludesObject(
                  user.groupsCommands,
                  "conversation_id",
                  chat.groupId
                )
              ) {
                return;
              } else {
                user.groupsCommands.push(deletedMember);
                user.save();
              }
            }
          });
        });
      });
  };

  socket.on("deleteMember", deleteMember);
  socket.on("deleteMember", storeWaitingDeletedGroupMembers);

  const sendChatMessage = async (data) => {
    const {
      conversation_name,
      conversation_id,
      sender,
      message_content,
      sender_id,
      group_create_time,
    } = data;
    const existedGroup = await Chat.findOne({ _id: conversation_id });
    const recipientIds = existedGroup.members.map((objectId) =>
      objectId.toString()
    );
    // console.log(recipientIds);
    const senderIndex = recipientIds.indexOf(sender_id);
    // console.log(senderIndex);
    if (senderIndex !== -1) {
      recipientIds.splice(senderIndex, 1);
    }
    // console.log(recipientIds);
    if (recipientIds.length > 0) {
      socketIO.sockets
        // .except(socket.id)
        .in(recipientIds)
        .emit("receiveMessage", data);
      socketIO.sockets
        // .except(socket.id)
        .in(recipientIds)
        .emit("groupMessage", data);
      socketIO.sockets
        // .except(socket.id)
        .in(recipientIds)
        .emit("receiveNotification", data);
    } else {
      console.log("No group message sent.");
    }
    const externalIds = recipientIds;
    await sendNotification(
      sender,
      message_content,
      externalIds,
      sender_id,
      conversation_id,
      conversation_name,
      group_create_time
    );
  };

  const sendPrivateMessage = async (data) => {
    const {
      recipient_id,
      sender,
      sender_id,
      message_content,
      conversation_id,
      addition_time,
      type,
    } = data;
    socketIO.to(recipient_id).emit("check", data);
    await User.findOne({ _id: recipient_id }).then((user) => {
      // const checkUser = !user || user === undefined;
      // if (!checkUser) return;
      if (user.connectId !== "") {
        socketIO.to(recipient_id).emit("receive_privateMessage", data);
        socketIO.to(recipient_id).emit("privateChatMessage", data);
        socketIO.to(recipient_id).emit("receive_privateNotification", data);
      } else {
        user.waitingMessages.push(data);
        user.save();
      }
    });
    const externalIds = [recipient_id];
    await sendNotification(
      sender,
      type === "text" ? message_content : type === "location" ? "Location" : "",
      externalIds,
      sender_id,
      conversation_id,
      "",
      addition_time
    );
  };

  agenda.define("sendGMsg", (data) => {
    const newData = data.attrs.data;
    delete newData.delay;
    sendChatMessage(newData);
  });

  agenda.define("sendPMsg", (data) => {
    const newData = data.attrs.data;
    delete newData.delay;
    sendPrivateMessage(newData);
  });

  const sendScheduleGroupMessage = async (data) => {
    (async function () {
      await agenda.start();
      const delay = data.delay;
      await agenda.schedule(delay, "sendGMsg", data);
    })();
  };

  const sendSchedulePrivateMessage = async (data) => {
    (async function () {
      await agenda.start();
      const delay = data.delay;
      await agenda.schedule(delay, "sendPMsg", data);
    })();
  };

  const storeWaitingChatMessage = async (message) => {
    const { conversation_id } = message;
    await Chat.findOne({ _id: conversation_id }).then((chat) => {
      chat.members.forEach((element) => {
        User.findOne({ _id: element.toString() }).then((user) => {
          if (user.connectId === "") {
            user.waitingChatMessages.push(message);
            user.save();
          }
        });
      });
    });
  };

  socket.on("send_message", sendChatMessage);
  socket.on("send_message", storeWaitingChatMessage);
  socket.on("send_scheduleGroupMessage", sendScheduleGroupMessage);

  socket.on("send_privateMessage", sendPrivateMessage);
  socket.on("send_schedulePrivateMessage", sendSchedulePrivateMessage);

  socket.on("sendWaitingMessage", async (bundle, cb) => {
    if (Object.keys(bundle).length <= 6) {
      await sendChatMessage(bundle);
      cb();
    } else {
      await sendPrivateMessage(bundle);
      cb();
    }
  });

  socket.on("update", async (id) => {
    await User.findOne({ _id: id }).then((user) => {
      if (user.groupsCommands.length === 0) {
        socket.emit("finishGroupCommands");
      } else {
        user.groupsCommands.forEach((command) => {
          // Find by group id
          if (Object.keys(command)[0] === "conversation_id") {
            console.log("1 ----> ", command);
            Chat.findOne({ groupId: command.conversation_id })
              .populate("members")
              .then(async (chat) => {
                socket.emit("newGroup", chat);
              });
            // Find by mongodb id
          } else if (Object.keys(command)[0] === "groupId") {
            console.log("2 ----> ", command);
            Chat.findOne({ _id: command.groupId })
              .populate("members")
              .then(async (chat) => {
                socket.emit("newGroup", chat);
              });
          } else if (Object.keys(command)[1] === "newMembers") {
            console.log("3 ----> ", command);
            User.find({ _id: { $in: command.newMembers } }).then((users) => {
              socket.emit("addGroupMembers", {
                group_id: command.group_id,
                newMembers: users,
              });
            });
          } else if (Object.keys(command)[1] === "deletedMember") {
            console.log("4 ----> ", command);
            socket.emit("deleteGroupMembers", command);
          }
        });
        socket.emit("finishGroupCommands");
      }
    });
  });

  socket.on("receiveWaitingMessage", async (id) => {
    console.log(id);
    await User.findOne({ _id: id }).then((user) => {
      if (
        user.waitingMessages.length === 0 &&
        user.waitingChatMessages.length === 0 &&
        user.groupsCommands.length === 0
      )
        return;

      if (user.waitingMessages.length !== 0) {
        socket.emit("receivePrivateWaitingMessage", user.waitingMessages);
        socket.emit("receivePrivateWaitingMessage(M.S)", user.waitingMessages);
        console.log("private chat array send");
      }
      if (user.waitingChatMessages.length !== 0) {
        socket.emit("receiveChatWaitingMessage", user.waitingChatMessages);
        console.log("Group chat array send");
      }
    });

    await User.findOneAndUpdate(
      { _id: id },
      {
        connectId: socket.id,
        waitingMessages: [],
        waitingChatMessages: [],
        groupsCommands: [],
        lastSeen: "",
      }
    ).then(() => {
      console.log("update connect success");
      socketIO.emit("lastSeen", "", id);
    });
    socket.emit("finishReceiveWaitingMessage");
  });

  socket.on("deleteMembershipFromGroup", (userId, deletedGroups) => {
    deletedGroups.forEach((groupId) => {
      deleteObject = { group_id: groupId, deletedMember: userId };
      deleteMember(deleteObject);
      storeWaitingNewGroupMembers(deleteObject);
    });
  });

  socket.on("fetchLastSeen", (id) => {
    User.findOne({ _id: id }).then((user) => {
      socket.emit("lastSeen", user.lastSeen, id);
    });
  });

  // ss(socket).on("image", (stream, data) => {

  // });

  socket.on("img", (messageImage) => {
    sendChatMessage(messageImage);
  });

  socket.on("disconnect", async () => {
    console.log("User disconnected ", socket.id);
    await User.findOneAndUpdate(
      { connectId: socket.id },
      { connectId: "", lastSeen: Date.now().toString() }
    ).then((user) => {
      if (user) {
        socketIO.emit("lastSeen", Date.now().toString(), user._id);
        console.log("update disconnect success");
      }
    });
  });
});

http.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

instrument(socketIO, { auth: false });
