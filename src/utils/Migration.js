import Progress from "../models/Progress.js";
import Question from "../models/Question.js";
import Video from "../models/Video.js";
import User from "../models/User.js";

// ─────────────────────────────────────────────────────────────────────────────
// MIGRATION SCRIPT: MIGRATE OLD PROGRESS DOCUMENTS TO NEW SNAPSHOT SCHEMA
// ─────────────────────────────────────────────────────────────────────────────
export const migrateProgressSchema = async (req, res) => {
  try {
    console.log("[MIGRATION START] Finding progress documents needing update...");

    // 1. Fetch all Progress documents
    const progressDocs = await Progress.find().lean();
    let updatedCount = 0;
    let skippedCount = 0;

    for (const doc of progressDocs) {
      let isModified = false;
      const updatedHistory = [];

      // A. Populate video & designation snapshot if missing
      let videoSnapshot = doc.videoSnapshot || null;
      let designationId = doc.designation || null;

      if (!videoSnapshot || !designationId) {
        const [videoData, userData] = await Promise.all([
          Video.findById(doc.video).populate("designation", "name").lean(),
          User.findById(doc.employee).select("designation").lean(),
        ]);

        if (videoData) {
          designationId = designationId || videoData.designation?._id || userData?.designation;
          videoSnapshot = videoSnapshot || {
            title: videoData.title || "",
            sortOrder: videoData.sortOrder || 1,
            duration: videoData.duration || "",
            designationName: videoData.designation?.name || "",
          };
          isModified = true;
        }
      }

      // B. Process each attempt in history
      for (const attempt of doc.history || []) {
        // If snapshot already exists, keep it as is
        if (attempt.snapshot && attempt.snapshot.length > 0) {
          updatedHistory.push(attempt);
          continue;
        }

        // If old 'answers' array exists, build new 'snapshot' array
        const snapshot = [];
        if (attempt.answers && attempt.answers.length > 0) {
          for (const ans of attempt.answers) {
            if (!ans.question) continue;

            const questionDoc = await Question.findById(ans.question).lean();
            if (questionDoc) {
              const selectedIndex = ans.selectedOption;
              const optionsFormatted = (questionDoc.options || []).map((opt, idx) => {
                // Determine correctness based on option structure
                const isCorrect = typeof opt === "object" ? !!opt.isCorrect : idx === questionDoc.correctOption;
                const optionText = typeof opt === "object" ? opt.optionText || opt.text : String(opt);
                return { optionText, isCorrect };
              });

              const isOptionCorrect = optionsFormatted[selectedIndex]?.isCorrect || false;

              snapshot.push({
                questionId: questionDoc.questionId || String(questionDoc._id),
                questionText: questionDoc.questionText || questionDoc.title || "",
                options: optionsFormatted,
                selectedOptionIndex: selectedIndex,
                isCorrect: isOptionCorrect,
              });
            }
          }
        }

        // Calculate score if missing or rebuild attempt object
        const correctCount = snapshot.filter((s) => s.isCorrect).length;
        const totalQ = snapshot.length || attempt.totalQuestions || 0;
        const passedStatus = attempt.passed !== undefined ? attempt.passed : correctCount >= Math.ceil(totalQ * 0.6);

        updatedHistory.push({
          score: attempt.score !== undefined ? attempt.score : correctCount,
          totalQuestions: totalQ,
          passed: passedStatus,
          attemptedAt: attempt.attemptedAt || new Date(),
          snapshot: snapshot,
        });

        isModified = true;
      }

      // C. Update the document in database
      if (isModified) {
        await Progress.updateOne(
          { _id: doc._id },
          {
            $set: {
              history: updatedHistory,
              videoSnapshot: videoSnapshot,
              designation: designationId,
              attempts: doc.history ? doc.history.length : doc.attempts,
            },
          }
        );
        updatedCount++;
      } else {
        skippedCount++;
      }
    }

    console.log(`[MIGRATION COMPLETE] Updated: ${updatedCount}, Skipped: ${skippedCount}`);

    return res.status(200).json({
      success: true,
      message: "Progress migration completed successfully",
      stats: { total: progressDocs.length, updated: updatedCount, skipped: skippedCount },
    });
  } catch (error) {
    console.error("Migration Failed:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
};