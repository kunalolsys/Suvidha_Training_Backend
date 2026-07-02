import mongoose from "mongoose";
import * as exceljs from "exceljs";

import Progress from "../models/Progress.js";
import User from "../models/User.js";
import Video from "../models/Video.js";
import Question from "../models/Question.js";

const toNumber = (v, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const buildSearchMatch = ({ field, search }) => {
  if (!search) return {};
  return {
    [field]: { $regex: search, $options: "i" },
  };
};

const parseCommaList = (v) => {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  return String(v)
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
};

const buildEmployeeTrainingStatusFilter = ({ status }) => {
  if (!status) return {};

  // status values (expected): not_started | in_progress | completed
  switch (status) {
    case "completed":
      return { completedVideosCount: { $gt: 0 }, isTrainingCompleted: true };
    case "in_progress":
      return { completedVideosCount: { $gt: 0 }, isTrainingCompleted: false };
    case "not_started":
      return { completedVideosCount: 0, anyProgressExists: true };
    default:
      return {};
  }
};

// Base building blocks
const baseProgresAgg = () => [
  {
    $lookup: {
      from: "users",
      localField: "employee",
      foreignField: "_id",
      as: "employeeObj",
    },
  },
  { $unwind: { path: "$employeeObj", preserveNullAndEmptyArrays: false } },
  {
    $lookup: {
      from: "videos",
      localField: "video",
      foreignField: "_id",
      as: "videoObj",
    },
  },
  { $unwind: { path: "$videoObj", preserveNullAndEmptyArrays: false } },
  {
    $lookup: {
      from: "designations",
      localField: "employeeObj.designation",
      foreignField: "_id",
      as: "designationObj",
    },
  },
  {
    $unwind: {
      path: "$designationObj",
      preserveNullAndEmptyArrays: true,
    },
  },
  {
    $lookup: {
      from: "stores",
      localField: "employeeObj.store",
      foreignField: "_id",
      as: "storeObj",
    },
  },
  {
    $unwind: {
      path: "$storeObj",
      preserveNullAndEmptyArrays: true,
    },
  },
  {
    $lookup: {
      from: "videos",
      localField: "videoObj.designation",
      foreignField: "_id",
      as: "videoDesignationObj",
    },
  },
  {
    $unwind: {
      path: "$videoDesignationObj",
      preserveNullAndEmptyArrays: true,
    },
  },
  {
    $project: {
      employee: "$employeeObj._id",
      employeeName: "$employeeObj.name",
      employeeEmail: "$employeeObj.email",
      employeeEmployeeId: "$employeeObj.employeeId",
      employeeRole: "$employeeObj.role",
      employeeDesignationId: "$employeeObj.designation",
      employeeStoreId: "$employeeObj.store",
      employeeDesignationTitle: "$designationObj.title",
      employeeStoreName: "$storeObj.name",

      video: "$videoObj._id",
      videoTitle: "$videoObj.title",
      videoDesignationId: "$videoObj.designation",
      videoSortOrder: "$videoObj.sortOrder",
      videoIsActive: "$videoObj.isActive",

      progressStatus: "$status",
      attempts: "$attempts",
      completedAt: "$completedAt",
      history: "$history",
    },
  },
];

export const getDashboard = async () => {
  // Dashboard metrics across all Admin/Employee.
  // Use a single aggregation on Progress for training/completion metrics.

  const pipeline = [
    ...baseProgresAgg(),
    {
      $match: {
        employeeRole: "Employee",
      },
    },
    {
      $group: {
        _id: null,
        completedVideosCount: {
          $sum: { $cond: [{ $eq: ["$progressStatus", "completed"] }, 1, 0] },
        },
        totalVideosInProgressScope: { $sum: 1 },

        completedEmployeesSet: { $addToSet: "$employee" },

        employeeHistory: {
          $push: {
            employee: "$employee",
            status: "$progressStatus",
            completedAt: "$completedAt",
            attempts: "$attempts",
            history: "$history",
          },
        },

        totalAttempts: {
          $sum: "$attempts",
        },
        averageScoreSum: {
          $sum: {
            $cond: [
              { $gt: [{ $size: "$history" }, 0] },
              { $arrayElemAt: ["$history.score", -1] },
              0,
            ],
          },
        },
        completedVideoCountForAvgScore: {
          $sum: {
            $cond: [{ $eq: ["$progressStatus", "completed"] }, 1, 0],
          },
        },
      },
    },
    {
      $addFields: {
        completionPercentage: {
          $cond: [
            { $eq: ["$totalVideosInProgressScope", 0] },
            0,
            {
              $multiply: [
                {
                  $divide: [
                    "$completedVideosCount",
                    "$totalVideosInProgressScope",
                  ],
                },
                100,
              ],
            },
          ],
        },
        averageScore: {
          $cond: [
            { $eq: ["$completedVideoCountForAvgScore", 0] },
            0,
            {
              $divide: ["$averageScoreSum", "$completedVideoCountForAvgScore"],
            },
          ],
        },
      },
    },
    {
      $project: {
        _id: 0,
        completedVideosCount: 1,
        totalVideosInProgressScope: 1,
        completionPercentage: 1,
        averageScore: 1,
        totalAttempts: 1,
      },
    },
  ];

  const [dashboardAgg] = await Promise.all([
    Progress.aggregate(pipeline),
    User.countDocuments({ role: "Employee", isActive: true }),
    User.countDocuments({ role: "Admin", isActive: true }),
    Video.countDocuments({ isActive: true }),
    // Total designations and stores are derived from their models
  ]);

  const completedVideosCount = dashboardAgg?.[0]?.completedVideosCount || 0;
  const totalVideosInProgressScope =
    dashboardAgg?.[0]?.totalVideosInProgressScope || 0;
  const completionPercentage = dashboardAgg?.[0]?.completionPercentage || 0;
  const averageScore = dashboardAgg?.[0]?.averageScore || 0;
  const totalAttempts = dashboardAgg?.[0]?.totalAttempts || 0;

  // Total stores/designations and completed employees need additional quick queries.
  // Keep these as parallel queries to avoid heavy cross joins.
  const [
    totalDesignations,
    totalQuestions,
    totalStores,
    completedEmployeesCount,
    employeeNotStartedCount,
    employeeInProgressCount,
    completedEmployeesAvg,
  ] = await Promise.all([
    (await import("../models/Designation.js")).default.countDocuments({}),
    (await import("../models/Question.js")).default.countDocuments({}),
    (await import("../models/Store.js")).default.countDocuments({}),
    // Completed employees: all their employee progress entries across all videos are completed.
    // Derive by checking per-employee completion ratio in aggregation.
    (async () => {
      const res = await Progress.aggregate([
        ...baseProgresAgg(),
        { $match: { employeeRole: "Employee" } },
        {
          $group: {
            _id: "$employee",
            totalEntries: { $sum: 1 },
            completedEntries: {
              $sum: {
                $cond: [{ $eq: ["$progressStatus", "completed"] }, 1, 0],
              },
            },
          },
        },
        {
          $addFields: {
            isEmployeeCompletedTraining: {
              $cond: [
                { $gt: ["$totalEntries", 0] },
                { $eq: ["$completedEntries", "$totalEntries"] },
                false,
              ],
            },
          },
        },
        {
          $match: { isEmployeeCompletedTraining: true },
        },
        { $count: "count" },
      ]);
      return res?.[0]?.count || 0;
    })(),
    (async () => {
      const res = await Progress.aggregate([
        ...baseProgresAgg(),
        { $match: { employeeRole: "Employee" } },
        {
          $group: {
            _id: "$employee",
            completedCount: {
              $sum: {
                $cond: [{ $eq: ["$progressStatus", "completed"] }, 1, 0],
              },
            },
            anyHistoryCount: {
              $sum: { $cond: [{ $gt: [{ $size: "$history" }, 0] }, 1, 0] },
            },
            anyProgressEntry: { $sum: 1 },
          },
        },
        {
          $match: {
            anyProgressEntry: { $gt: 0 },
            completedCount: 0,
          },
        },
        { $count: "count" },
      ]);
      return res?.[0]?.count || 0;
    })(),
    (async () => {
      const res = await Progress.aggregate([
        ...baseProgresAgg(),
        { $match: { employeeRole: "Employee" } },
        {
          $group: {
            _id: "$employee",
            totalEntries: { $sum: 1 },
            completedEntries: {
              $sum: {
                $cond: [{ $eq: ["$progressStatus", "completed"] }, 1, 0],
              },
            },
          },
        },
        {
          $match: {
            totalEntries: { $gt: 0 },
            completedEntries: { $gt: 0 },
          },
        },
        // Exclude fully completed employees
        {
          $match: {
            $expr: { $lt: ["$completedEntries", "$totalEntries"] },
          },
        },
        { $count: "count" },
      ]);
      return res?.[0]?.count || 0;
    })(),
    0,
  ]);

  return {
    totalEmployees: dashboardAgg
      ? await User.countDocuments({ role: "Employee" })
      : 0,
    totalQuestions,
    totalStores,
    totalDesignations,
    totalVideos: await Video.countDocuments({ isActive: true }),
    completedVideos: completedVideosCount,
    completedEmployees: completedEmployeesCount,
    averageScore,
    completionPercentage,
    totalAttempts,
    employeesInProgress: employeeInProgressCount,
    employeesNotStarted: employeeNotStartedCount,
  };
};

export const getEmployeesReport = async ({
  page,
  limit,
  search,
  designation,
  store,
  status,
}) => {
  const p = toNumber(page, 1);
  const l = toNumber(limit, 10);
  const skip = (p - 1) * l;

  const employeeSearchMatch = search
    ? {
        $or: [
          { employeeName: { $regex: search, $options: "i" } },
          { employeeEmail: { $regex: search, $options: "i" } },
          { employeeEmployeeId: { $regex: search, $options: "i" } },
        ],
      }
    : {};

  const pipeline = [
    ...baseProgresAgg(),
    { $match: { employeeRole: "Employee" } },

    // Filters applied after lookup projection
    {
      $match: {
        ...employeeSearchMatch,
        ...(designation
          ? { employeeDesignationId: new mongoose.Types.ObjectId(designation) }
          : {}),
        ...(store
          ? { employeeStoreId: new mongoose.Types.ObjectId(store) }
          : {}),
      },
    },

    // derive per-employee training summary
    {
      $group: {
        _id: "$employee",
        employeeId: { $first: "$employeeEmployeeId" },
        employeeName: { $first: "$employeeName" },
        employeeEmail: { $first: "$employeeEmail" },
        storeId: { $first: "$employeeStoreId" },
        storeName: { $first: "$employeeStoreName" },
        designationId: { $first: "$employeeDesignationId" },
        designationTitle: { $first: "$employeeDesignationTitle" },

        totalVideosAttemptedOrAssigned: { $sum: 1 },
        completedVideosCount: {
          $sum: { $cond: [{ $eq: ["$progressStatus", "completed"] }, 1, 0] },
        },
        attempts: { $sum: "$attempts" },
        lastActivityAt: { $max: "$completedAt" },
        lastAttemptAt: {
          $max: {
            $cond: [
              { $gt: [{ $size: "$history" }, 0] },
              { $arrayElemAt: ["$history.attemptedAt", -1] },
              "$completedAt",
            ],
          },
        },

        sumLatestScores: {
          $sum: {
            $cond: [
              { $gt: [{ $size: "$history" }, 0] },
              { $arrayElemAt: ["$history.score", -1] },
              0,
            ],
          },
        },
        completedVideoCountForAvgScore: {
          $sum: {
            $cond: [
              { $gt: [{ $size: "$history" }, 0] },
              { $cond: [{ $eq: ["$progressStatus", "completed"] }, 1, 1] },
              0,
            ],
          },
        },

        anyProgressExists: { $sum: 1 },
        isTrainingCompleted: {
          $min: {
            $cond: [{ $eq: ["$progressStatus", "completed"] }, 1, 0],
          },
        },
      },
    },
    {
      $addFields: {
        completionPercentage: {
          $cond: [
            { $eq: ["$totalVideosAttemptedOrAssigned", 0] },
            0,
            {
              $multiply: [
                {
                  $divide: [
                    "$completedVideosCount",
                    "$totalVideosAttemptedOrAssigned",
                  ],
                },
                100,
              ],
            },
          ],
        },
        averageScore: {
          $cond: [
            { $eq: ["$completedVideosCount", 0] },
            0,
            { $divide: ["$sumLatestScores", "$completedVideosCount"] },
          ],
        },
        // training completion boolean derived: isTrainingCompleted is 1 if all entries are completed.
        isTrainingCompleted: { $eq: ["$isTrainingCompleted", 1] },
      },
    },

    // Filter by derived status
    {
      $match: {
        ...(status ? buildEmployeeTrainingStatusFilter({ status }) : {}),
      },
    },

    { $sort: { lastActivityAt: -1, employeeName: 1 } },

    {
      $facet: {
        docs: [
          { $skip: skip },
          { $limit: l },
          {
            $project: {
              _id: 0,
              employee: {
                id: "$_id",
                employeeId: "$employeeId",
                name: "$employeeName",
                email: "$employeeEmail",
              },
              store: { id: "$storeId", name: "$storeName" },
              designation: { id: "$designationId", title: "$designationTitle" },
              completedVideos: "$completedVideosCount",
              totalVideos: "$totalVideosAttemptedOrAssigned",
              completionPercentage: { $round: ["$completionPercentage", 2] },
              averageScore: { $round: ["$averageScore", 2] },
              attempts: "$attempts",
              lastActivityAt: 1,
              currentStatus: {
                $cond: [
                  "$isTrainingCompleted",
                  "completed",
                  {
                    $cond: [
                      { $gt: ["$completedVideosCount", 0] },
                      "in_progress",
                      "not_started",
                    ],
                  },
                ],
              },
            },
          },
        ],
        totalCount: [{ $count: "count" }],
      },
    },
  ];

  const [res] = await Progress.aggregate(pipeline);
  const docs = res?.docs || [];
  const total = res?.totalCount?.[0]?.count || 0;

  return {
    employees: docs,
    total,
    page: p,
    limit: l,
    totalPages: Math.ceil(total / l) || 1,
  };
};

export const getEmployeeDetails = async (id) => {
  const employeeId = new mongoose.Types.ObjectId(id);

  const pipeline = [
    ...baseProgresAgg(),
    { $match: { employeeRole: "Employee", employee: employeeId } },
    {
      $group: {
        _id: "$employee",
        employee: {
          $first: {
            id: "$employee",
            employeeId: "$employeeEmployeeId",
            name: "$employeeName",
            email: "$employeeEmail",
          },
        },
        store: {
          $first: { id: "$employeeStoreId", name: "$employeeStoreName" },
        },
        designation: {
          $first: {
            id: "$employeeDesignationId",
            title: "$employeeDesignationTitle",
          },
        },
        completedAt: { $max: "$completedAt" },
        videos: {
          $push: {
            videoId: "$video",
            title: "$videoTitle",
            status: "$progressStatus",
            completedAt: "$completedAt",
            attempts: "$attempts",
            history: "$history",
            videoSortOrder: "$videoSortOrder",
          },
        },
      },
    },
    {
      $addFields: {
        videos: {
          $sortArray: { input: "$videos", sortBy: { videoSortOrder: 1 } },
        },
      },
    },
    {
      $addFields: {
        history: {
          $reduce: {
            input: "$videos",
            initialValue: [],
            in: {
              $concatArrays: ["$$value", "$$this.history"],
            },
          },
        },
        completedVideos: {
          $filter: {
            input: "$videos",
            as: "v",
            cond: { $eq: ["$$v.status", "completed"] },
          },
        },
        currentLockedVideo: {
          $first: {
            $filter: {
              input: "$videos",
              as: "v",
              cond: { $eq: ["$$v.status", "locked"] },
            },
          },
        },
      },
    },
    {
      $project: {
        _id: 0,
        employee: 1,
        store: 1,
        designation: 1,
        completionDate: "$completedAt",
        currentLockedVideo: {
          $cond: [
            { $ifNull: ["$currentLockedVideo", false] },
            {
              videoId: "$currentLockedVideo.videoId",
              title: "$currentLockedVideo.title",
              sortOrder: "$currentLockedVideo.videoSortOrder",
            },
            null,
          ],
        },
        videos: {
          $map: {
            input: "$videos",
            as: "v",
            in: {
              videoId: "$$v.videoId",
              title: "$$v.title",
              status: "$$v.status",
              completedAt: "$$v.completedAt",
              attempts: "$$v.attempts",
              history: "$$v.history",
            },
          },
        },
        quizAttempts: "$history",
      },
    },
  ];

  const [data] = await Progress.aggregate(pipeline);
  if (!data) throw new Error("Employee not found");

  return data;
};

export const getStoresReport = async () => {
  const pipeline = [
    ...baseProgresAgg(),
    { $match: { employeeRole: "Employee" } },
    {
      $group: {
        _id: "$employeeStoreId",
        storeName: { $first: "$employeeStoreName" },
        employeesCount: { $addToSet: "$employee" },
        // completed employees: fully completed across all entries for that employee
      },
    },
    {
      $addFields: {
        employeeCount: { $size: "$employeesCount" },
      },
    },
    {
      $project: {
        _id: 0,
        store: { id: "$_id", name: "$storeName" },
        employeeCount: 1,
      },
    },
  ];

  const byStore = await Progress.aggregate(pipeline);

  // Additional metrics: completed employees, avg score per store.
  const completedMetrics = await Progress.aggregate([
    ...baseProgresAgg(),
    { $match: { employeeRole: "Employee" } },
    {
      $group: {
        _id: { storeId: "$employeeStoreId", employee: "$employee" },
        totalEntries: { $sum: 1 },
        completedEntries: {
          $sum: { $cond: [{ $eq: ["$progressStatus", "completed"] }, 1, 0] },
        },
        scoreSum: {
          $sum: {
            $cond: [
              { $gt: [{ $size: "$history" }, 0] },
              { $arrayElemAt: ["$history.score", -1] },
              0,
            ],
          },
        },
        completedCountForAvg: {
          $sum: {
            $cond: [{ $eq: ["$progressStatus", "completed"] }, 1, 0],
          },
        },
        attemptsSum: { $sum: "$attempts" },
        storeName: { $first: "$employeeStoreName" },
      },
    },
    {
      $addFields: {
        isCompleted: { $eq: ["$completedEntries", "$totalEntries"] },
      },
    },
    {
      $group: {
        _id: "$_id.storeId",
        storeName: { $first: "$storeName" },
        completedEmployees: {
          $sum: { $cond: [{ $eq: ["$isCompleted", true] }, 1, 0] },
        },
        employeeCount: { $sum: 1 },
        averageScore: {
          $cond: [
            { $eq: [{ $sum: "$completedCountForAvg" }, 0] },
            0,
            {
              $divide: [
                { $sum: "$scoreSum" },
                { $sum: "$completedCountForAvg" },
              ],
            },
          ],
        },
      },
    },
    {
      $addFields: {
        completionPercentage: {
          $cond: [
            { $eq: ["$employeeCount", 0] },
            0,
            {
              $multiply: [
                { $divide: ["$completedEmployees", "$employeeCount"] },
                100,
              ],
            },
          ],
        },
      },
    },
    {
      $project: {
        _id: 0,
        store: { id: "$_id", name: "$storeName" },
        employeeCount: 1,
        completedEmployees: 1,
        completionPercentage: { $round: ["$completionPercentage", 2] },
        averageScore: { $round: ["$averageScore", 2] },
      },
    },
  ]);

  return completedMetrics;
};

export const getDesignationsReport = async () => {
  const pipeline = [
    ...baseProgresAgg(),
    { $match: { employeeRole: "Employee" } },
    {
      $group: {
        _id: "$employeeDesignationId",
        designationTitle: { $first: "$employeeDesignationTitle" },
      },
    },
  ];

  // Metrics per designation
  const metrics = await Progress.aggregate([
    ...baseProgresAgg(),
    { $match: { employeeRole: "Employee" } },
    {
      $group: {
        _id: { designationId: "$employeeDesignationId", employee: "$employee" },
        totalEntries: { $sum: 1 },
        completedEntries: {
          $sum: { $cond: [{ $eq: ["$progressStatus", "completed"] }, 1, 0] },
        },
        scoreSum: {
          $sum: {
            $cond: [
              { $gt: [{ $size: "$history" }, 0] },
              { $arrayElemAt: ["$history.score", -1] },
              0,
            ],
          },
        },
        completedCountForAvg: {
          $sum: {
            $cond: [{ $eq: ["$progressStatus", "completed"] }, 1, 0],
          },
        },
        designationTitle: { $first: "$employeeDesignationTitle" },
      },
    },
    {
      $addFields: {
        isCompleted: { $eq: ["$completedEntries", "$totalEntries"] },
      },
    },
    {
      $group: {
        _id: "$_id.designationId",
        designationTitle: { $first: "$designationTitle" },
        employeesCount: { $sum: 1 },
        completedEmployees: {
          $sum: { $cond: [{ $eq: ["$isCompleted", true] }, 1, 0] },
        },
        averageScore: {
          $cond: [
            { $eq: [{ $sum: "$completedCountForAvg" }, 0] },
            0,
            {
              $divide: [
                { $sum: "$scoreSum" },
                { $sum: "$completedCountForAvg" },
              ],
            },
          ],
        },
      },
    },
    {
      $addFields: {
        completionPercentage: {
          $cond: [
            { $eq: ["$employeesCount", 0] },
            0,
            {
              $multiply: [
                { $divide: ["$completedEmployees", "$employeesCount"] },
                100,
              ],
            },
          ],
        },
      },
    },
    {
      $project: {
        _id: 0,
        designation: { id: "$_id", title: "$designationTitle" },
        employeeCount: "$employeesCount",
        completedEmployees: 1,
        completionPercentage: { $round: ["$completionPercentage", 2] },
        averageScore: { $round: ["$averageScore", 2] },
        videoCount: 0,
      },
    },
  ]);

  // Attach videoCount for each designation without N+1: one aggregation on videos.
  const videoCounts = await Video.aggregate([
    { $match: { isActive: true } },
    { $group: { _id: "$designation", count: { $sum: 1 } } },
    { $project: { _id: 0, designationId: "$_id", videoCount: "$count" } },
  ]);
  const map = new Map(
    videoCounts.map((x) => [String(x.designationId), x.videoCount]),
  );

  return metrics.map((d) => ({
    ...d,
    videoCount: map.get(String(d.designation.id)) || 0,
  }));
};

export const getVideosAnalytics = async ({
  page,
  limit,
  search,
  designation,
  status,
}) => {
  const p = toNumber(page, 1);
  const l = toNumber(limit, 10);
  const skip = (p - 1) * l;

  const match = { videoIsActive: true };
  if (designation)
    match.videoDesignationId = new mongoose.Types.ObjectId(designation);
  if (status) {
    if (status === "completed") match.progressStatus = "completed";
    if (status === "failed") match.progressStatus = { $ne: "completed" };
  }
  if (search) {
    match.videoTitle = { $regex: search, $options: "i" };
  }

  const pipeline = [
    ...baseProgresAgg(),
    { $match: { employeeRole: "Employee" } },
    { $match: match },
    {
      $group: {
        _id: "$video",
        videoTitle: { $first: "$videoTitle" },
        assignedEmployeesSet: { $addToSet: "$employee" },
        completedEmployeesSet: {
          $addToSet: {
            $cond: [
              { $eq: ["$progressStatus", "completed"] },
              "$employee",
              null,
            ],
          },
        },
        failedAttempts: {
          $sum: {
            $cond: [{ $eq: ["$progressStatus", "completed"] }, 0, "$attempts"],
          },
        },
        totalAttempts: { $sum: "$attempts" },
        latestScores: {
          $push: {
            $cond: [
              { $gt: [{ $size: "$history" }, 0] },
              { $arrayElemAt: ["$history.score", -1] },
              null,
            ],
          },
        },
      },
    },
    {
      $addFields: {
        assignedEmployees: { $size: "$assignedEmployeesSet" },
        completedEmployees: {
          $size: {
            $setDifference: ["$completedEmployeesSet", [null]],
          },
        },
        averageScore: {
          $let: {
            vars: {
              filtered: {
                $filter: {
                  input: "$latestScores",
                  as: "s",
                  cond: { $ne: ["$$s", null] },
                },
              },
            },
            in: {
              $cond: [
                { $eq: [{ $size: "$$filtered" }, 0] },
                0,
                { $divide: [{ $sum: "$$filtered" }, { $size: "$$filtered" }] },
              ],
            },
          },
        },
        averageAttempts: {
          $cond: [
            { $eq: [{ $size: "$assignedEmployeesSet" }, 0] },
            0,
            { $divide: ["$totalAttempts", { $size: "$assignedEmployeesSet" }] },
          ],
        },
        completionPercentage: {
          $cond: [
            { $eq: [{ $size: "$assignedEmployeesSet" }, 0] },
            0,
            {
              $multiply: [
                {
                  $divide: [
                    {
                      $size: {
                        $setDifference: ["$completedEmployeesSet", [null]],
                      },
                    },
                    { $size: "$assignedEmployeesSet" },
                  ],
                },
                100,
              ],
            },
          ],
        },
      },
    },
    { $sort: { completionPercentage: -1 } },
    {
      $facet: {
        docs: [
          { $skip: skip },
          { $limit: l },
          {
            $project: {
              _id: 0,
              video: { id: "$_id", title: "$videoTitle" },
              assignedEmployees: 1,
              completedEmployees: 1,
              failedAttempts: 1,
              averageScore: { $round: ["$averageScore", 2] },
              averageAttempts: { $round: ["$averageAttempts", 2] },
              completionPercentage: { $round: ["$completionPercentage", 2] },
            },
          },
        ],
        totalCount: [{ $count: "count" }],
      },
    },
  ];

  const [res] = await Progress.aggregate(pipeline);
  const docs = res?.docs || [];
  const total = res?.totalCount?.[0]?.count || 0;

  return {
    videos: docs,
    total,
    page: p,
    limit: l,
    totalPages: Math.ceil(total / l) || 1,
  };
};

export const getTopPerformers = async () => {
  const pipeline = [
    ...baseProgresAgg(),
    { $match: { employeeRole: "Employee" } },
    {
      $group: {
        _id: "$employee",
        employee: {
          $first: {
            id: "$employee",
            name: "$employeeName",
            employeeId: "$employeeEmployeeId",
          },
        },
        completedVideosCount: {
          $sum: { $cond: [{ $eq: ["$progressStatus", "completed"] }, 1, 0] },
        },
        totalVideosEntries: { $sum: 1 },
        sumLatestScores: {
          $sum: {
            $cond: [
              { $gt: [{ $size: "$history" }, 0] },
              { $arrayElemAt: ["$history.score", -1] },
              0,
            ],
          },
        },
        completedCountForAvgScore: {
          $sum: { $cond: [{ $eq: ["$progressStatus", "completed"] }, 1, 0] },
        },
      },
    },
    {
      $addFields: {
        averageScore: {
          $cond: [
            { $eq: ["$completedCountForAvgScore", 0] },
            0,
            { $divide: ["$sumLatestScores", "$completedCountForAvgScore"] },
          ],
        },
        completionPercentage: {
          $cond: [
            { $eq: ["$totalVideosEntries", 0] },
            0,
            {
              $multiply: [
                { $divide: ["$completedVideosCount", "$totalVideosEntries"] },
                100,
              ],
            },
          ],
        },
      },
    },
    { $sort: { averageScore: -1, completionPercentage: -1 } },
    { $limit: 10 },
    {
      $project: {
        _id: 0,
        employee: 1,
        averageScore: { $round: ["$averageScore", 2] },
        completionPercentage: { $round: ["$completionPercentage", 2] },
        completedVideos: "$completedVideosCount",
      },
    },
  ];

  return await Progress.aggregate(pipeline);
};

export const getFailedEmployees = async () => {
  // Failed latest attempt => history.last attempt where passed=false.
  const pipeline = [
    ...baseProgresAgg(),
    { $match: { employeeRole: "Employee" } },
    { $unwind: { path: "$history", preserveNullAndEmptyArrays: false } },
    {
      $match: { "history.passed": false },
    },
    {
      $group: {
        _id: "$employee",
        employee: {
          $first: {
            id: "$employee",
            name: "$employeeName",
            employeeId: "$employeeEmployeeId",
            email: "$employeeEmail",
          },
        },
        latestFailedAttemptAt: { $max: "$history.attemptedAt" },
      },
    },
    {
      $lookup: {
        from: "progresses",
        let: { employeeId: "$_id" },
        pipeline: [
          {
            $match: {
              $expr: { $eq: ["$employee", "$$employeeId"] },
            },
          },
          { $unwind: { path: "$history", preserveNullAndEmptyArrays: false } },
          { $match: { "history.passed": false } },
          {
            $sort: { "history.attemptedAt": -1 },
          },
          { $limit: 1 },
          {
            $project: {
              _id: 0,
              score: "$history.score",
              totalQuestions: "$history.totalQuestions",
              attemptedAt: "$history.attemptedAt",
              videoId: "$video",
            },
          },
        ],
        as: "latest",
      },
    },
    { $unwind: { path: "$latest", preserveNullAndEmptyArrays: true } },
    {
      $project: {
        _id: 0,
        employee: 1,
        latestFailedAttemptAt: 1,
        latestAttempt: {
          score: "$latest.score",
          totalQuestions: "$latest.totalQuestions",
          attemptedAt: "$latest.attemptedAt",
          videoId: "$latest.videoId",
        },
      },
    },
    { $sort: { latestFailedAttemptAt: -1 } },
  ];

  return await Progress.aggregate(pipeline);
};

export const getRecentActivity = async () => {
  const completedVideos = await Progress.aggregate([
    ...baseProgresAgg(),
    { $match: { employeeRole: "Employee", progressStatus: "completed" } },
    { $sort: { completedAt: -1 } },
    { $limit: 10 },
    {
      $project: {
        _id: 0,
        type: { $literal: "video_completed" },
        employee: { id: "$employee", name: "$employeeName" },
        video: { id: "$video", title: "$videoTitle" },
        completedAt: 1,
      },
    },
  ]);

  const latestQuizAttempts = await Progress.aggregate([
    ...baseProgresAgg(),
    { $match: { employeeRole: "Employee" } },
    { $unwind: { path: "$history", preserveNullAndEmptyArrays: false } },
    { $sort: { "history.attemptedAt": -1 } },
    { $limit: 10 },
    {
      $project: {
        _id: 0,
        type: { $literal: "quiz_attempt" },
        employee: { id: "$employee", name: "$employeeName" },
        video: { id: "$video", title: "$videoTitle" },
        attemptedAt: "$history.attemptedAt",
        score: "$history.score",
        totalQuestions: "$history.totalQuestions",
        passed: "$history.passed",
      },
    },
  ]);

  const latestUnlocks = await Progress.aggregate([
    ...baseProgresAgg(),
    { $match: { employeeRole: "Employee", progressStatus: "unlocked" } },
    { $sort: { createdAt: -1 } },
    { $limit: 10 },
    {
      $project: {
        _id: 0,
        type: { $literal: "video_unlocked" },
        employee: { id: "$employee", name: "$employeeName" },
        video: { id: "$video", title: "$videoTitle" },
        unlockedAt: "$createdAt",
      },
    },
  ]);

  return {
    completedVideos,
    latestQuizAttempts,
    latestUnlocks,
  };
};

export const exportReport = async ({ filters }) => {
  // For export: use employees report as dataset.
  const { search, designation, store, status } = filters || {};

  const { employees } = await getEmployeesReport({
    page: 1,
    limit: 100000,
    search,
    designation,
    store,
    status,
  });

  const workbook = new exceljs.Workbook();
  const worksheet = workbook.addWorksheet("Employees Report");

  worksheet.columns = [
    { header: "Employee ID", key: "employeeId", width: 14 },
    { header: "Employee Name", key: "employeeName", width: 22 },
    { header: "Email", key: "email", width: 28 },
    { header: "Store", key: "storeName", width: 18 },
    { header: "Designation", key: "designationTitle", width: 22 },
    { header: "Completed Videos", key: "completedVideos", width: 18 },
    { header: "Total Videos", key: "totalVideos", width: 12 },
    { header: "Completion %", key: "completionPercentage", width: 16 },
    { header: "Average Score", key: "averageScore", width: 16 },
    { header: "Attempts", key: "attempts", width: 10 },
    { header: "Last Activity", key: "lastActivityAt", width: 20 },
    { header: "Current Status", key: "currentStatus", width: 16 },
  ];

  employees.forEach((e) => {
    worksheet.addRow({
      employeeId: e.employee.employeeId,
      employeeName: e.employee.name,
      email: e.employee.email,
      storeName: e.store?.name,
      designationTitle: e.designation?.title,
      completedVideos: e.completedVideos,
      totalVideos: e.totalVideos,
      completionPercentage: e.completionPercentage,
      averageScore: e.averageScore,
      attempts: e.attempts,
      lastActivityAt: e.lastActivityAt,
      currentStatus: e.currentStatus,
    });
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return buffer;
};

export default {
  getDashboard,
  getEmployeesReport,
  getEmployeeDetails,
  getStoresReport,
  getDesignationsReport,
  getVideosAnalytics,
  getTopPerformers,
  getFailedEmployees,
  getRecentActivity,
  exportReport,
};
