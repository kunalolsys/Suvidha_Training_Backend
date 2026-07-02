import asyncHandler from "../middleware/asyncHandler.js";
import ApiResponse from "../utils/ApiResponse.js";
import ApiError from "../utils/ApiError.js";

import * as reportService from "../services/report.service.js";

const getPagination = (req) => {
  const page = req.query.page ? Number(req.query.page) : 1;
  const limit = req.query.limit ? Number(req.query.limit) : 10;
  if (!Number.isFinite(page) || page < 1)
    throw new ApiError(400, "Invalid page");
  if (!Number.isFinite(limit) || limit < 1 || limit > 500) {
    throw new ApiError(400, "Invalid limit");
  }
  return { page, limit };
};

export const getDashboard = asyncHandler(async (req, res) => {
  const data = await reportService.getDashboard();
  return res.status(200).json(new ApiResponse(200, "Dashboard fetched", data));
});

export const getEmployees = asyncHandler(async (req, res) => {
  const { page, limit } = getPagination(req);

  const data = await reportService.getEmployeesReport({
    page,
    limit,
    search: req.query.search,
    designation: req.query.designation,
    store: req.query.store,
    status: req.query.status,
  });

  return res
    .status(200)
    .json(new ApiResponse(200, "Employees report fetched", data));
});

export const getEmployeeById = asyncHandler(async (req, res) => {
  const data = await reportService.getEmployeeDetails(req.params.id);
  return res
    .status(200)
    .json(new ApiResponse(200, "Employee details fetched", data));
});

export const getStores = asyncHandler(async (req, res) => {
  const data = await reportService.getStoresReport();
  return res
    .status(200)
    .json(new ApiResponse(200, "Stores report fetched", data));
});

export const getDesignations = asyncHandler(async (req, res) => {
  const data = await reportService.getDesignationsReport();
  return res
    .status(200)
    .json(new ApiResponse(200, "Designations report fetched", data));
});

export const getVideos = asyncHandler(async (req, res) => {
  const { page, limit } = getPagination(req);

  const data = await reportService.getVideosAnalytics({
    page,
    limit,
    search: req.query.search,
    designation: req.query.designation,
    status: req.query.status,
  });

  return res
    .status(200)
    .json(new ApiResponse(200, "Videos analytics fetched", data));
});

export const getTopPerformers = asyncHandler(async (req, res) => {
  const data = await reportService.getTopPerformers();
  return res
    .status(200)
    .json(new ApiResponse(200, "Top performers fetched", data));
});

export const getFailedEmployees = asyncHandler(async (req, res) => {
  const data = await reportService.getFailedEmployees();
  return res
    .status(200)
    .json(new ApiResponse(200, "Failed employees fetched", data));
});

export const getActivity = asyncHandler(async (req, res) => {
  const data = await reportService.getRecentActivity();
  return res
    .status(200)
    .json(new ApiResponse(200, "Recent activity fetched", data));
});

export const exportReport = asyncHandler(async (req, res) => {
  const { search, designation, store, status } = req.query;

  const buffer = await reportService.exportReport({
    filters: { search, designation, store, status },
  });

  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  res.setHeader("Content-Disposition", `attachment; filename=report.xlsx`);

  return res.status(200).send(buffer);
});
