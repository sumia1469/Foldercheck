const http = require('http')
const fs=require('fs')
const path=require('path')
const {exec, execSync} = require('child_process')

const PORT=4400
const interval=3000
let fileTimestamps={}
let watchedFolders=[]
let networkCredentials={}

function connectToNetwork(username,password,serverIP){
    try{
      console.log(`네트워크 폴더 로그인: &{serverIP}`);
      execSync(`use net \\\\${serverIP} /user:${username} ${password}`, {stdio:'ignore'});
    }catch(e){
console.error(`네트워크 로그인 실패:${e.message}`);
    }
}

function loadwatchedFolders(){
    try{
const data=fs.readFileSync('folderList.json', 'utf8');
    }catch(e){

    }
}