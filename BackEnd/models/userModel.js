const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const userSchema = new mongoose.Schema({
  googleId: String,
  username: {
    type: String,
    required: true,
    min: 3,
    max: 20,
  },
  email: {
    type: String,
    required: true,
    unique: true,
    max: 50,
  },
  password: {
    type: String,
  },
  connectId: String,
  waitingMessages: [Object],
  waitingChatMessages: [Object],
  groupsCommands: [Object],
  lastSeen: String,
});

userSchema.methods.matchPassword = async function (enteredPassword) {
  const isPasswordValid = bcrypt.compare(enteredPassword, this.password);
  return isPasswordValid;
};

userSchema.pre("save", async function (next) {
  if (this.password) {
    if (!this.isModified) {
      next();
    }
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
  }
});

const User = mongoose.model("User", userSchema);

module.exports = User;
