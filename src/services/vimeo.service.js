import dotenv from "dotenv";
import { Vimeo } from "vimeo";

dotenv.config();
const vimeoClient = new Vimeo(
  process.env.VIMEO_CLIENT_ID,
  process.env.VIMEO_CLIENT_SECRET,
  process.env.VIMEO_ACCESS_TOKEN,
);

export default vimeoClient;
