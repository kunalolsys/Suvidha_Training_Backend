import jwt from "jsonwebtoken";
import User from "../models/User.js";
import ApiError from "../utils/ApiError.js";

export const protect = async (req, res, next) => {
  try {
    let token;

    if (
      req.headers.authorization &&
      req.headers.authorization.startsWith("Bearer ")
    ) {
      token = req.headers.authorization.split(" ")[1];
    }

    if (!token) {
      return next(new ApiError(401, "Unauthorized"));
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    req.user = await User.findById(decoded.id)
      .select("-password")
      .populate("designation")
      .populate("store");

    if (!req.user) {
      return next(new ApiError(401, "User not found"));
    }

    next();
  } catch (error) {
    next(new ApiError(401, "Invalid Token"));
  }
};
