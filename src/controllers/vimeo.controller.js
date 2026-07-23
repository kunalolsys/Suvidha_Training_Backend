import axios from "axios";
import vimeoClient from "../services/vimeo.service.js";

/**
 * Upload Video to Vimeo
 */
export const uploadVideo = (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "Video file is required",
      });
    }

    const videoPath = req.file.path;

    vimeoClient.upload(
      videoPath,
      {
        name: req.body.title || "My Training Video",
        description: req.body.description || "This is my training video",
      },

      // Upload completed
      function (uri) {
        console.log("Upload completed:", uri);

        // Vimeo URI:
        // /videos/123456789

        const videoId = uri.split("/").pop();

        return res.status(200).json({
          success: true,
          message: "Video uploaded successfully",

          videoId,

          uri,

          embedUrl: `https://player.vimeo.com/video/${videoId}`,
        });
      },

      // Upload progress
      function (bytesUploaded, bytesTotal) {
        const percentage = ((bytesUploaded / bytesTotal) * 100).toFixed(2);

        console.log(`Upload progress: ${percentage}%`);
      },

      // Upload error
      function (error) {
        console.error("Upload failed:", error);

        return res.status(500).json({
          success: false,
          message: "Video upload failed",
          error: error?.message || error,
        });
      },
    );
  } catch (error) {
    console.error("Upload error:", error);

    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

/**
 * Get Vimeo Video By ID
 */
const vimeoCache = new Map();

export const getVimeoVideoById = async (req, res) => {
  try {
    const { videoId } = req.params;

    if (!videoId) {
      return res.status(400).json({
        success: false,
        message: "Vimeo video ID is required",
      });
    }

    // Check cache first
    if (vimeoCache.has(videoId)) {
      console.log("Returning Vimeo video from cache");

      return res.status(200).json({
        success: true,
        video: vimeoCache.get(videoId),
      });
    }

    vimeoClient.request(
      {
        method: "GET",
        path: `/videos/${videoId}`,
      },
      (error, body) => {
        if (error) {
          console.error("Vimeo API Error:", error);

          return res.status(500).json({
            success: false,
            message: "Failed to get Vimeo video",
            error: error.message,
          });
        }

        // Save response in cache
        vimeoCache.set(videoId, body);

        return res.status(200).json({
          success: true,
          video: body,
        });
      },
    );
  } catch (error) {
    console.error("Get Vimeo video error:", error);

    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// Simple in-memory cache
let vimeoVideosCache = null;

export const getAllVimeoVideos = async (req, res) => {
  try {
    // ============================================
    // RETURN CACHE IF ALREADY AVAILABLE
    // ============================================
    if (vimeoVideosCache) {
      console.log("Returning Vimeo videos from cache");

      return res.status(200).json({
        ...vimeoVideosCache,
        source: "cache",
      });
    }

    // ============================================
    // CACHE EMPTY → CALL VIMEO API
    // ============================================
    console.log("Cache empty. Fetching videos from Vimeo...");

    const allVideos = [];

    let page = 1;
    const perPage = 100;

    while (true) {
      const response = await axios.get("https://api.vimeo.com/me/videos", {
        headers: {
          Authorization: `Bearer ${process.env.VIMEO_ACCESS_TOKEN}`,
        },
        params: {
          page,
          per_page: perPage,
          sort: "date",
          direction: "desc",
        },
      });

      const videos = response.data.data || [];

      allVideos.push(...videos);

      // Stop if there is no next page
      if (!response.data.paging?.next) {
        break;
      }

      page++;
    }

    // ============================================
    // SAVE RESPONSE IN CACHE
    // ============================================
    vimeoVideosCache = {
      success: true,
      total: allVideos.length,
      videos: allVideos,
    };

    console.log(`Vimeo videos cached successfully: ${allVideos.length}`);

    // ============================================
    // RETURN RESPONSE
    // ============================================
    return res.status(200).json({
      ...vimeoVideosCache,
      source: "vimeo",
    });
  } catch (error) {
    console.error(
      "Get all Vimeo videos error:",
      error.response?.data || error.message,
    );

    return res.status(500).json({
      success: false,
      message: "Failed to fetch Vimeo videos",
      error: error.response?.data || error.message,
    });
  }
};
