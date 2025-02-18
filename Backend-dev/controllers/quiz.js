const { GoogleGenerativeAI } = require("@google/generative-ai");
require("dotenv").config();

const Question = require("../models/question");
const quiz = require("../models/quizzes");
const leaderboard = require("../models/leaderboard");

const API_KEY = process.env.API_KEY;

const genAI = new GoogleGenerativeAI(API_KEY);

async function handleGetAllQuizzesAndDisplay(req, res) {
  const quizzes = await quiz.find({}).populate("createdBy");
  return res.render("show-quiz", { quizzes });
}

async function handleCreateNewQuiz(req, res) {
  const body = req.body;
  if (!body) {
    return res.send("Fields Required!");
  }
  const result = await quiz.create({
    title: body.title,
    description: body.description,
    createdBy: req.user._id,
    interactionHistory: [],
  });
  return res.redirect(`/quiz/${result._id}`);
}

async function handleGetQuizByIdAndshowQuestions(req, res) {
  const quizId = req.params.quiz_id;
  try {
    const resultQuiz = await quiz
      .findById({ _id: quizId })
      .populate("questionsById.questionId");

    if (!resultQuiz) {
      return res.redirect("/quiz");
    }

    const checkCreator = () => {
      if (req.user._id == resultQuiz.createdBy._id) return true;
      return false;
    };
    isCreator = checkCreator();

    // Need to add a check point so that only the interaction history remains unique
    // await quiz.findOneAndUpdate(
    //   { _id: req.params.quiz_id },
    //   {
    //     $push: {
    //       interactionHistory: { userId: req.user._id, timestamps: Date.now() },
    //     },
    //   }
    // );

    return res.render("Create-Quiz", {
      resultQuiz,
      quizId,
      questions: resultQuiz.questionsById,
      isCreator,
    });
  } catch (error) {
    // console.log("handleGetQuizById Error: ", error);

    return res.redirect("/quiz");
  }
}

async function handleAddQuestionsInTheQuiz(req, res) {
  const quest = req.body;
  console.log(quest)
  const choices = [quest.choice1, quest.choice2, quest.choice3, quest.choice4];
  if (!choices.includes(quest.correctChoice)) {
    return res.redirect(`/quiz/${req.params.quiz_id}`);
  }
  const resultQues = await Question.create({
    QuizId: req.params.quiz_id,
    question: quest.question,
    choices: choices,
    correctChoice: quest.correctChoice,
    points: Number(quest.points),
  });

  await quiz.findOneAndUpdate(
    { _id: req.params.quiz_id },
    {
      $push: {
        questionsById: { questionId: resultQues._id },
      },
    }
  );

  return res.redirect(`/quiz/${req.params.quiz_id}`);
}

async function handleDeleteQuizById(req, res) {
  const quizId = req.params.quiz_id;
  try {
    await quiz.findByIdAndDelete({ _id: quizId });
    await Question.deleteMany({ QuizId: quizId });
    await leaderboard.findOneAndDelete({ quizId: quizId });
    return res.redirect(`/quiz`);
  } catch (error) {
    return res.send("Failed to Delete!");
  }
}

async function handleDeleteQuestionById(req, res) {
  const quizId = req.params.quiz_id;
  const quesId = req.params.ques_id;

  try {
    await quiz.updateOne(
      { _id: quizId },
      {
        $pull: {
          questionsById: { questionId: quesId },
        },
      }
    );
    await Question.findOneAndDelete({ _id: quesId });
  } catch (error) {
    console.log(error);
  }
  res.redirect(`/quiz/${quizId}`);
}

async function handlePlayQuizRequest(req, res) {
  // if (localStorage.length != 0) {
  //   const score = localStorage.getItem("UserScore");
  //   const QuizId = localStorage.getItem("QuizId");
  //   console.log(score, QuizId);
  //   localStorage.clear();
  // }

  res.render("play-quiz", { quizId: req.params.quiz_id });
}

async function handlePostPlayQuizByQuestionId(req, res) {
  const playQues = await Question.find({ QuizId: req.params.quiz_id });
  return res.send(playQues);
}

async function handleGenerateQuizs(req, res) {
  if (!req.body.prompt) return res.redirect("/quiz");
  const promtInput = req.body.prompt;
  const model = genAI.getGenerativeModel({ model: "gemini-pro" });

  const prompt = `${promtInput}.make 10 quizzes of mcq having 4 options and answer seperatly in following json
     format.[{"id":0,"question":"","choices":[],"correctChoice":""}, ...], response content-type : "application/json"`;
  const result = await model.generateContent(prompt);
  const response = await result.response;
  let text = response.text().split("```")[1];
  try {
    if (text.startsWith("json")) {
      text = text.slice(4);
    }
    // text = JSON.stringify(text);
    text = JSON.parse(text);
  } catch (error) {
    console.log("Failed To Parse!");
    return res.send(`Failed To Generate , may be some internet problem!`);
  }

  try {
    const genQuiz = await quiz.create({
      title: req.body.title,
      description: `${req.body.description}(This quiz is generated by AI)`,
      createdBy: req.user._id,
      interactionHistory: [],
    });

    text.forEach(async (q) => {
      const choices = [q.choices[0], q.choices[1], q.choices[2], q.choices[3]];
      const resultQues = await Question.create({
        QuizId: genQuiz._id,
        question: q.question,
        choices: choices,
        correctChoice: q.correctChoice,
        points: req.body.points,
      });
      await quiz.findOneAndUpdate(
        { _id: genQuiz._id },
        {
          $push: {
            questionsById: { questionId: resultQues._id },
          },
        }
      );
    });
    return res.redirect(`/quiz/${genQuiz._id}`);
  } catch (error) {
    return res.send(`Failed To Create Quiz!`);
  }
}

async function handlePostLeaderBoard(req, res) {
  if (!(await leaderboard.findOne({ quizId: req.params.quiz_id }))) {
    await leaderboard.create({
      quizId: req.params.quiz_id,
      participants: [],
      totalScore: 0,
    });
  }

  const result = await leaderboard.findOneAndUpdate(
    { quizId: req.params.quiz_id },
    {
      $push: {
        participants: {
          userId: req.user._id,
          userName: req.user.fullName,
          score: req.body.score,
          attempt: 1,
        },
      },
      $set: { totalScore: req.body.totalScore },
    }
  );
  // const data = await leaderboard.findOne({
  //   "participants.userName": req.user.fullName,
  // });
  // const check = () => {
  //   if (data.participants.attempt >= 1) {
  //     return true;
  //   } else return false;
  // };

  // console.log(check());

  // // console.log(await leaderboard.findOne({ "participants.userName": req.user.fullName }));
  // if (check()) {
  //   await leaderboard.updateOne(
  //     { participants: { $elemMatch: { userName: req.user.fullName } } },
  //     { $set: { "participants.$.score": req.body.score, "participants.$.attemp": "participants.$.attemp" + 1} }
  //   );
  //   console.log("Updated..\n");
  // } else {
  //   const result = await leaderboard.findOneAndUpdate(
  //     { quizId: req.params.quiz_id },
  //     {
  //       $push: {
  //         participants: {
  //           userId: req.user._id,
  //           userName: req.user.fullName,
  //           score: req.body.score,
  //           attempt: 1,
  //         },
  //       },
  //       $set: { totalScore: req.body.totalScore },
  //     }
  //   );
  //   console.log("Added..");
  // }

  return res.redirect(`/quiz/play/leaderboard/${req.params.quiz_id}`);
}

async function handleGetLeaderBoardData(req, res) {
  let result = await leaderboard
    .findOne({ quizId: req.params.quiz_id })
    .populate("quizId");
  const quizDetail = await quiz
    .findOne({ _id: req.params.quiz_id })
    .populate("createdBy");
  // console.log(quizDetail);
  try {
    if (result.participants)
      result.participants = result.participants.sort(
        (a, b) => b.score - a.score
      );
  } catch (error) {}
  // console.log(result);

  return res.render("leaderboard", { result, quizDetail });
}

module.exports = {
  handleGetAllQuizzesAndDisplay,
  handleCreateNewQuiz,
  handleGetQuizByIdAndshowQuestions,
  handleAddQuestionsInTheQuiz,
  handleDeleteQuizById,
  handleDeleteQuestionById,
  handlePlayQuizRequest,
  handlePostPlayQuizByQuestionId,
  handleGenerateQuizs,
  handlePostLeaderBoard,
  handleGetLeaderBoardData,
};
