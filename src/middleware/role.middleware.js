import ApiError from "../utils/ApiError.js";

export const authorize = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return next(
        new ApiError(403, "You are not authorized to perform this action"),
      );
    }

    next();
  };
};
//**Usage */
// router.post(
//   "/",
//   protect,
//   authorize("Admin"),
//   createStore
// );

// router.get(
//   "/profile",
//   protect,
//   authorize("Admin", "Employee"),
//   getProfile
// );
