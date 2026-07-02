import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import cookieParser from "cookie-parser";
import allRoutes from "./routes/index.js";
import errorHandler from "./middleware/error.middleware.js";
const app = express();

app.use(
  cors({
    origin: true,
    credentials: true,
  }),
);
app.use(helmet());

app.use(morgan("dev"));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(cookieParser());
app.use("/api/v1", allRoutes);

app.use(errorHandler)
app.get("/", (req, res) => {
  res.status(200).json({
    success: true,
    message: "STU Backend Running 🚀",
  });
});

export default app;
