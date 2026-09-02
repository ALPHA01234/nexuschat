const mongoose = require("mongoose");

const FriendRequestSchema = new mongoose.Schema({
  from: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
    index: true,
  },
  to: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
    index: true,
  },
  status: {
    type: String,
    enum: ["pending", "accepted", "rejected", "cancelled"],
    default: "pending",
    index: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  respondedAt: {
    type: Date,
  },
});

// Prevent duplicate pending requests between the same two users/direction
FriendRequestSchema.index({ from: 1, to: 1, status: 1 });

module.exports = mongoose.model("FriendRequest", FriendRequestSchema);
