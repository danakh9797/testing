const { OAuth2Client } = require("google-auth-library");
const jwt = require("jsonwebtoken");
const asyncHandler = require("express-async-handler");

const User = require("../models/userModel");
const Chat = require("../models/chatModel");

const generateToken = (id) => {
  const token = jwt.sign({ id }, "Q$r2K6W8n!jCW%Zk", { expiresIn: "365d" });
  return token;
};

const CLIENT_ID =
  "154300403552-fmh5q3oaev0moblhct4ro9mas0mso7pu.apps.googleusercontent.com";
const client = new OAuth2Client(CLIENT_ID);

const protect = asyncHandler(async (req, res, next) => {
  let token;

  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith("Bearer")
  ) {
    try {
      token = req.headers.authorization.split(" ")[1];

      const decoded = jwt.verify(token, "Q$r2K6W8n!jCW%Zk");

      req.user = await User.findById(decoded.id).select("-password");

      next();
    } catch (error) {
      res.status(401);
      throw new Error("Not authorized, token failed");
    }
  }

  if (!token) {
    res.status(401);
    throw new Error("Not authorized, no token");
  }
});

const registerUser = async (req, res) => {
  try {
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ message: "Please enter all the fields" });
    }

    let userExists = await User.findOne({ email });
    if (userExists) {
      console.error("User already exists");
      return res.status(400).json({ message: "User already exists" });
    }

    const connectId = "";
    const waitingMessages = [];
    const waitingChatMessages = [];
    const lastSeen = "";
    const groupsCommands = [];
    const newUser = new User({
      username,
      email,
      password,
      connectId,
      waitingMessages,
      waitingChatMessages,
      groupsCommands,
      lastSeen,
    });
    await newUser.save();

    const id = newUser._id;
    const token = generateToken(newUser._id);
    return res.status(200).json({ id, username, email, token });
  } catch (error) {
    console.error("Error registering the user", error);
    return res.status(500).json({ message: "Error registering the user!" });
  }
};

const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      console.log("Email and the password are required");
      return res
        .status(404)
        .json({ message: "Email and the password are required" });
    }

    await User.findOne({ email }).then(async (user) => {
      if (!user) {
        console.error("User not found");
        return res.status(404).json({ message: "User not found" });
      } else if (user && user.matchPassword(password)) {
        await Chat.find({ members: user })
          .populate("members")
          .then((groups) => {
            const userGroups = groups;

            const id = user._id;
            const username = user.username;
            const email = user.email;
            const token = generateToken(user._id);
            return res
              .status(200)
              .json({ id, username, email, token, userGroups });
          });
      } else {
        console.error("Invalid password");
        return res.status(401).json({ message: "Invalid password" });
      }
    });
  } catch (error) {
    console.error("Error in finding the user", error);
    return res.status(500).json({ message: "Internal server Error!" });
  }
};

const verifyGoogleSignIn = async (tokenId) => {
  try {
    // Verify Google ID token
    const ticket = await client.verifyIdToken({
      idToken: tokenId,
      audience: CLIENT_ID,
    });

    // Extract user information from the verified token
    const payload = ticket.getPayload();
    const username = payload.name;
    const email = payload.email;

    const { sub: googleId } = ticket.getPayload();

    await User.findOne({ email }).then(async (user) => {
      if (!user) {
        const connectId = "";
        const waitingMessages = [];
        const waitingChatMessages = [];
        const lastSeen = "";
        const groupsCommands = [];
        const newUser = new User({
          username,
          email,
          googleId,
          connectId,
          waitingMessages,
          waitingChatMessages,
          groupsCommands,
          lastSeen,
        });

        await newUser.save();
      }
      console.log(user);
      return user;
    });
  } catch (error) {
    console.error("Google Sign-In error:", error);
    throw error;
  }
};

const googleSignIn = async (req, res) => {
  const tokenId = Object.keys(req.body)[0];
  try {
    const user = await verifyGoogleSignIn(tokenId);
    await Chat.find({ members: user })
      .populate("members")
      .then((groups) => {
        const userGroups = groups;
        const name = user.username;
        const email = user.email;
        const id = user._id;
        const token = generateToken(user._id);
        res.status(200).json({ name, email, id, token, userGroups });
        console.log(id);
      });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const googleIsSignedIn = async (req, res) => {
  const googleUserId = Object.keys(req.body)[0];
  try {
    await User.findOne({ googleId: googleUserId }).then(async (user) => {
      if (user) {
        await Chat.find({ members: user })
          .populate("members")
          .then((groups) => {
            const userGroups = groups;
            const name = user.username;
            const email = user.email;
            const id = user._id;
            const token = generateToken(user._id);
            console.log(id);
            res.status(200).json({ name, email, id, token, userGroups });
          });
      } else {
        res.status(404).json({ message: "User not found" });
      }
    });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const searchUser = async (req, res) => {
  const keyword = req.query.search
    ? {
        $or: [
          { username: { $regex: req.query.search, $options: "i" } },
          // { email: { $regex: req.query.search, $options: "i" } },
        ],
      }
    : {};

  const users = await User.find(keyword).find({ _id: { $ne: req.user._id } });

  res.send(users);
};

module.exports = {
  protect,
  registerUser,
  login,
  googleSignIn,
  googleIsSignedIn,
  searchUser,
};
