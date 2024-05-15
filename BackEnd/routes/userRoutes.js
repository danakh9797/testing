const express = require("express");
const router = express.Router();

const {
  protect,
  registerUser,
  login,
  googleSignIn,
  googleIsSignedIn,
  searchUser,
} = require("../controllers/userController");

router.route("/register").post(registerUser).get(protect, searchUser);

router.post("/login", login);

router.post("/googleSignIn", googleSignIn);

router.post("/googleSignIn/:googleUserId", googleIsSignedIn);

module.exports = router;
