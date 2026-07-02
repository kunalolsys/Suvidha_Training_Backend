const errorHandler = (err, req, res, next) => {
  return res.status(err.statusCode || 500).json({
    success: false,
    message: err.message,
    statusCode: err.statusCode || 500,
  });
};

export default errorHandler;
