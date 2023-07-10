#!/usr/bin/env node

/** 
 * 
 * 参考： https://segmentfault.com/a/1190000015467084
 * 优化：通过 X-Forwarded-For 添加了动态随机伪IP，绕过 tinypng 的上传数量限制
 * 
 *  */

const fs = require('fs');
const path = require('path');
const https = require('https');
const { URL } = require('url');


const cwd = process.cwd();

const root = path.join(cwd, "source");
const outputDir = path.join(cwd , 'output');
  exts = ['.jpg', '.png'],
  max = 5200000; // 5MB == 5242848.754299136

const options = {
  method: 'POST',
  hostname: 'tinypng.com',
  path: '/backend/opt/shrink',
  headers: {
    rejectUnauthorized: false,
    'Postman-Token': Date.now(),
    'Cache-Control': 'no-cache',
    'Content-Type': 'application/x-www-form-urlencoded',
    'User-Agent':
      'Mozilla/5.0 (Windows NT 6.1; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/56.0.2924.87 Safari/537.36'
  }
};

const taskManager = {
  taskList: [],
  totalCount: 0,
  finishCount: 0,
  taskFinish: () => {
    const task = taskManager.taskList.shift();
    if(task) {
      task();
    }
    taskManager.finishCount += 1;
    if(taskManager.finishCount == taskManager.totalCount) {
      console.log("所有任务处理完成！");
      process.openStdin();
    }
  },
  maxParallel: 1,
  start: () => {
    taskManager.totalCount = taskManager.taskList.length;
    const initCount = taskManager.taskList.slice(0, taskManager.maxParallel).length;
    for(let i = 0; i < initCount; i++) {
      taskManager.taskList.shift()();
    }
  },
}

startFromFolder(root);

// 生成随机IP， 赋值给 X-Forwarded-For
function getRandomIP() {
  return Array.from(Array(4)).map(() => parseInt(Math.random() * 255)).join('.')
}

// 获取文件列表
function startFromFolder(folder) {
  // 遍历搜索所有符合条件的文件
  const dirList = [folder]
  const fileList = [];
  for(let i = 0; i < dirList.length; i++) {
    const dirPath = dirList[i];
    const dirContentList = fs.readdirSync(dirPath);
    dirContentList.forEach(file => {
      file = path.join(dirPath, file);
      const stats = fs.statSync(file);
      // 目录
      if(stats.isDirectory(file)) {
        dirList.push(file);
      }
      // 文件
      else {
        const result = fileFilter(stats, file);
        if(result) {
          fileList.push(file);
        }
      }
    });
  }
  if(fileList.length == 0) {
    console.log("当前没有需可以处理的图片，请退出");
    process.openStdin();
  }
  // 形成任务列表
  taskManager.taskList = fileList.map(file => (() => fileUpload(file)));
  taskManager.start();
}

// 过滤文件格式，返回true false
function fileFilter(stats, file) {
  // 大小、格式
  if(
    stats.size <= max &&
    stats.isFile() &&
    exts.includes(path.extname(file))
  ) {
    // 是否已输出过
    const outputPath = path.join(outputDir, file.replace(root, ''));
    if(fs.existsSync(outputPath)) {
      console.log(`输出路径${outputPath}已存在文件，跳过压缩。`);
    } else {
      return true;
    }
  } else {
    console.error(`文件${file}不符合文件规范，尺寸大于5mb或不是png/jpg文件`);
  }
  return false;
}

// 异步API,压缩图片
// {"error":"Bad request","message":"Request is invalid"}
// {"input": { "size": 887, "type": "image/png" },"output": { "size": 785, "type": "image/png", "width": 81, "height": 81, "ratio": 0.885, "url": "https://tinypng.com/web/output/7aztz90nq5p9545zch8gjzqg5ubdatd6" }}
function fileUpload(img) {
  // 通过 X-Forwarded-For 头部伪造客户端IP
  options.headers['X-Forwarded-For'] = getRandomIP();
  var req = https.request(options, function(res) {
    res.on('data', buf => {
      let obj = JSON.parse(buf.toString());
      if (obj.error) {
        console.log(`[${img}]：压缩失败！报错：${obj.message}`, (new Date()).toLocaleTimeString());
        taskManager.taskFinish();
      } else {
        fileUpdate(img, obj);
      }
    });
  });

  req.write(fs.readFileSync(img), 'binary');
  req.on('error', e => {
    console.error(e);
  });
  req.end();
}

// 该方法被循环调用,请求图片数据
function fileUpdate(imgpath, obj) {
  imgpath = path.join(outputDir, imgpath.replace(root, ''));

  const lastDirPath = imgpath.split(path.sep).slice(0, -1).join(path.sep);
  if(!fs.existsSync(lastDirPath)) {
    fs.mkdirSync(lastDirPath, { recursive: true });
  }

  let options = new URL(obj.output.url);
  let req = https.request(options, res => {
    let body = '';
    res.setEncoding('binary');
    res.on('data', function(data) {
      body += data;
    });

    res.on('end', function() {
      fs.writeFile(imgpath, body, 'binary', err => {
        if (err) return console.error(err);
        console.log(
          `[${imgpath}] \n 压缩成功，原始大小-${obj.input.size}，压缩大小-${
            obj.output.size
          }，优化比例-${obj.output.ratio}。剩余任务${taskManager.taskList.length}。`
        );
        setTimeout(taskManager.taskFinish, 5000)
      });
    });
  });
  req.on('error', e => {
    console.error(e);
  });
  req.end();
}
