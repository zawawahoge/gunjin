﻿//サーバー
var express = require("express");
var app = express();
var ejs = require("ejs");
var Kyokumen = require("./public/js/GunjinShogiProgram.js");

var http = require("http").Server(app);
var io = require("socket.io")(http);
app.use(express.static("public"));
app.set("port", (process.env.PORT || 5000));

app.engine("ejs",ejs.renderFile);

app.get("/", function (req, res) {
    res.sendFile("index.html");
});

app.get("/game", function (req, res) {
    res.render(__dirname + "/public/taisen.ejs",
        {title:"対局部屋", roomNum:req.query.r});

});




io.on("connection", function (socket) {

    console.log("client connected");


    var room;

    //ソケットが切れたときの処理
    socket.on("disconnect", function () {
        var n = mng.RemoveSocket(socket);

        //部屋に参加している人がいなくなったときは部屋を初期化する
        if(n!=0){
	    	mng.rooms[n].MsgToServer("部屋にいるのは現在 "+ mng.rooms[n].clientList.length+" 人です");
	        io.to(mng.rooms[n].name).emit("clientchange", {roomstate:mng.rooms[n].state});
          if(mng.rooms[n].clientList.length==0){
          
            mng.rooms[n].Init();
          }
        }
    });

	socket.on("givemerooms",function(){
		mng.SendRoomState(socket);
	});

    //対戦申し込みの処理
    socket.on("taisenmachi", function (data) {
        socket.roomN = data.roomNum;
        room = mng.rooms[data.roomNum];
		room.MsgToServer(data.name + " が参加しました");

		//空室ならば対戦待ちに、対戦待ちがいればマッチング
        switch(room.state){

            case ROOMSTATE.EMPTY:
	        	room.AddClient(socket,data);
	        	room.StateChange(ROOMSTATE.WAITING);
	            room.MsgToServer(data.name + " が対戦を待っています...");
        		break;

        	case ROOMSTATE.WAITING:
	        	room.AddClient(socket,data);
                room.MsgToServer("マッチング成功");

        	    //先後をランダムで決定する
                var gameData = {};
                var sente = Math.floor(Math.random() * 2);
                gameData.sente = room.clientList[sente];
                gameData.gote = room.clientList[1 - sente];
                room.NewGame(gameData);
                room.MsgToServer("先手:" + gameData.sente.name + " vs 後手:" + gameData.gote.name);
                io.to(room.sente.id).emit("SENGO", 1);
                io.to(room.gote.id).emit("SENGO", 2);

                io.to(room.name).emit("taisenKettei", room.game);
                io.to(room.name).emit("haitichange",{sente:room.sente.haitiKanryo,gote:room.gote.haitiKanryo});
	        	room.StateChange(ROOMSTATE.HAITIMODE);
        		break;

			case ROOMSTATE.BATTLEFINISH:
                socket.emit("err","感想戦中です。\n空室になるのを待つか、他の部屋に入室してください。");
				break;
        	default:
                //観戦処理...
                socket.emit("err","対戦中なので入れません");
        		break;
        }


    });

    //配置受信、チェック
    socket.on("haitikettei", function (board) {
        //var room = mng.rooms[socket.roomN];
        var roomN = socket.roomN;

        //配置チェックしレスポンスを返す

        if (room.game.HaitiCheck(board)) {

            socket.emit("haitikettei", "配置おk");

            switch (socket.id) {
                case room.sente.socket.id:
                    room.MsgToServer("先手 " + room.game.sente.name + " 配置完了");
                    room.game.sente.board = board;
                    room.sente.haitiKanryo = true;
                    io.to(room.name).emit("haitichange",{sente:room.sente.haitiKanryo,gote:room.gote.haitiKanryo});
                    break;
                case room.gote.socket.id:
                    room.MsgToServer("後手 " + room.game.gote.name + " 配置完了");
                    room.game.gote.board = board;
                    room.gote.haitiKanryo = true;
                    io.to(room.name).emit("haitichange",{sente:room.sente.haitiKanryo,gote:room.gote.haitiKanryo});
                    break;
            }

            if (room.sente.haitiKanryo && room.gote.haitiKanryo) {
            	room.StateChange(ROOMSTATE.BATTLE);
                room.MsgToServer("配置完了、対局開始");
                room.game.SetInitKyokumen();

                room.game.Start();
                io.to(room.sente.id).emit("gamestart", room.game.GetSenteBoard());
                io.to(room.gote.id).emit("gamestart", room.game.GetGoteBoard());
            }

        } else {
            socket.emit("haitikettei", "配置やり直し");
        }
    });

    socket.on("haitichange",function(){
		switch (socket.id) {
            case room.sente.socket.id:
                room.MsgToServer("先手 " + room.game.sente.name + " 配置取り消し");
                room.sente.haitiKanryo = false;
                io.to(room.name).emit("haitichange",{sente:room.sente.haitiKanryo,gote:room.gote.haitiKanryo});
                break;
            case room.gote.socket.id:
                room.MsgToServer("後手 " + room.game.gote.name + " 配置取り消し");
                room.gote.haitiKanryo = false;
                io.to(room.name).emit("haitichange",{sente:room.sente.haitiKanryo,gote:room.gote.haitiKanryo});
                break;
        }
    });

    socket.on("sashite", function (te) {
        room.MsgToServer(room.game.kyokumen.TeHugou(te));
        room.game.Fight(te);

        var gameData = {};
        gameData.lastTe = room.game.kyokumen.lastTe;
        gameData.deadKomas = room.game.kyokumen.deadKomas;

        var v = room.game.FinishCheck();

        switch (v) {

            //対局続行
            case 0:
                gameData.board = room.game.GetSenteBoard(false);
                io.to(room.sente.id).emit("sashite", gameData);

				gameData.deadKomas.reverse();
                gameData.board = room.game.GetGoteBoard(false);
                io.to(room.gote.id).emit("sashite", gameData);
                gameData.deadKomas.reverse();
                break;
            //終局
            case 1:
            case 2:
            case 3:
            	room.StateChange(ROOMSTATE.BATTLEFINISH);
                var vicMsg = ["", "先手勝利", "後手勝利", "引き分け"];
                gameData.vicMsg = vicMsg[v];
                room.MsgToServer(vicMsg[v]);

                gameData.kifu = room.game.kifu;

                gameData.board = room.game.GetSenteBoard(true);
                io.to(room.sente.id).emit("gamefinish", gameData);

                gameData.board = room.game.GetGoteBoard(true);
                io.to(room.gote.id).emit("gamefinish", gameData);

                break;
        }

    });
    
    socket.on("touryou",function(sengo){    	
    	var v;
  		switch(socket.id){
    		case room.sente.id:
    			v = 2;
    			break;
    		case room.gote.id:
    			v = 1;
    			break;
    		default:
    			room.MsgToServer("error");
    			break;
    	}
    	var gameData = {};
    	room.StateChange(ROOMSTATE.BATTLEFINISH);
        var vicMsg = ["", "先手勝利", "後手勝利", "引き分け"];
        gameData.vicMsg = vicMsg[v];
        room.MsgToServer(vicMsg[v]);

        gameData.kifu = room.game.kifu;

        gameData.board = room.game.GetSenteBoard(true);
        io.to(room.sente.id).emit("gamefinish", gameData);

        gameData.board = room.game.GetGoteBoard(true);
        io.to(room.gote.id).emit("gamefinish", gameData);
    });
    
    socket.on("hikiwake",function(d){
    	switch(socket.id){
    		case room.sente.id:
    			io.to(room.gote.id).emit("hikiwake",{});
    			break;
    		case room.gote.id:
    			io.to(room.sente.id).emit("hikiwake",{});
    			break;
    	}
    });
    socket.on("hikiwakeres",function(hikiwake){
    	if(hikiwake){
	    	var v = 3;//引き分け
	    	var gameData = {};
	    	room.StateChange(ROOMSTATE.BATTLEFINISH);
	        var vicMsg = ["", "先手勝利", "後手勝利", "引き分け"];
	        gameData.vicMsg = vicMsg[v];
	        room.MsgToServer(vicMsg[v]);

	        gameData.kifu = room.game.kifu;

	        gameData.board = room.game.GetSenteBoard(true);
	        io.to(room.sente.id).emit("gamefinish", gameData);

	        gameData.board = room.game.GetGoteBoard(true);
	        io.to(room.gote.id).emit("gamefinish", gameData);
    	}else{
	    	switch(socket.id){
	    		case room.sente.id:
	    			io.to(room.gote.id).emit("hikiwakeres",hikiwake);
	    			break;
	    		case room.gote.id:
	    			io.to(room.sente.id).emit("hikiwakeres",hikiwake);
	    			break;
	    	}    	
    	}

    });

});

var Game = (function () {

    var Game = function (gameData) {
        this.sente = {};
        this.gote = {};
        this.sente.name = gameData.sente.name;
        this.gote.name = gameData.gote.name;
        this.sente.board = [];
        this.gote.board = [];

        //棋譜の表現：initBoardを配列の最初に、手数ごとにboardそのものを要素とする配列を作る
        this.kifu = [];

        this.kyokumen = new Kyokumen();
    };

    var p = Game.prototype;
    p.SetInitKyokumen = function (senteBoard,goteBoard) {
        this.kyokumen.CreateInitBoardFromPlayers(this.sente.board, this.gote.board);
        this.BoardPushToKifu();
    };

    //配置チェックしてtrue,falseで返す
    p.HaitiCheck = function (board) {
        return true;
    }

    //flag:trueであれば全て表
    p.GetSenteBoard = function (flag) {
        return this.kyokumen.GetSenteBoard(flag);
    };
    p.GetGoteBoard = function (flag) {
        return this.kyokumen.GetGoteBoard(flag);
    };
    p.Start = function () {

    };
    p.Fight = function (te) {
        this.kyokumen.Fight(te);
        this.BoardPushToKifu();
    }
    p.FinishCheck = function () {
        return this.kyokumen.FinishCheck();
    }
    p.BoardPushToKifu = function(){

		var temp = [
		            [17, 1, 2, 3, 4, 5, 6, 7, 7, 8, 8, 9, 9, 10, 11, 11, 12, 12, 13, 13, 14, 14, 15],
		            [64, 0, 0, 0, 0, 0, 0, 64],
		            [64, 0, 0, 0, 0, 0, 0, 64],
		            [64, 0, 0, 0, 0, 0, 0, 64],
		            [64, 0, 0, 0, 0, 0, 0, 64],
		            [64, 0, 0, 0, 0, 0, 0, 64],
		            [64, 0, 0, 0, 0, 0, 0, 64],
		            [64, 0, 0, 0, 0, 0, 0, 64],
		            [64, 0, 0, 0, 0, 0, 0, 64],
		            [64, 64, 64, 64, 64, 64, 64, 64]
		];

    	var board = this.kyokumen.board;
    	for(var dan=1;dan<=this.kyokumen.dan;dan++){
    		for(var suji=1;suji<=this.kyokumen.suji;suji++){
    			temp[dan][suji] = board[dan][suji];
    		}
    	}
	    var deadKomas = [];
		for(var i=0;i<=1;i++){
			deadKomas[i] = [];
			for(var j=0;j<this.kyokumen.deadKomas[i].length;j++){
				deadKomas[i][j] = this.kyokumen.deadKomas[i][j];
			}
		}
    	this.kifu.push({board:temp,deadKomas:deadKomas});
    };

    p.CreateGameData = function(){


    };


    return Game;
})();


var Client = (function () {


    var Client = function (socket) {
        this.socket = socket;
        this.id = socket.id;
        this.haitiKanryo = false;
    };

    var p = Client.prototype;

    p.idIsMine = function (id) {
        return this.socket.id == id;
    }

    return Client;
})();


var ROOMSTATE = {
    EMPTY: 0,
    WAITING: 1,
    HAITIMODE: 2,
    BATTLE: 3,
    BATTLEFINISH: 4
}

var Room = (function () {

    var Room = function (roomN) {
        this.roomN = roomN;
        this.clientList = [];
        this.state = ROOMSTATE.EMPTY;
        this.name = "room" + this.roomN;
        this.sente = {};
        this.gote = {};
        this.sente.name = "";
        this.gote.name = "";
    };

    var p = Room.prototype;

    p.Init = function(){
    	this.clientList = [];
    	this.StateChange(ROOMSTATE.EMPTY);
      this.sente = {};
      this.gote = {};
      this.sente.name = "";
      this.gote.name = "";
      this.MsgToServer("初期化されました");
    };

    //指定されたソケットを部屋に追加
    p.AddClient = function (socket,userData) {
        var client = new Client(socket);
        client.name = userData.name;
        this.clientList.push(client);
	    socket.join(this.name);
        return this.clientList;
    };

    //指定されたソケットが存在すれば削除し、いなければエラーをサーバーに送信する関数
    p.RemoveClient = function (socket) {
        for (var i = 0; i < this.clientList.length; i++) {
            if (this.clientList[i].idIsMine(socket.id)) {
                //console.log(this.clientList);
                this.clientList.splice(i, 1);
                //console.log(this.clientList);
                return;
            }
        }
        this.MsgToServer("error 削除しようとしたユーザーがいませんでした")
    };

    //この部屋に指定したソケットが存在しているかどうかを返す関数
    p.ContainSocket = function (socket) {
        for (var i = 0; i < this.clientList.length; i++) {
            if (this.clientList[i].idIsMine(socket.id)) {
                return true;
            }
        }
        return false;
    };

    //部屋番号を付与してサーバーに送信する関数
    p.MsgToServer = function (msg) {
        console.log(this.roomN + " : " + msg);
    }

    p.NewGame = function (gameData) {
        this.game = new Game(gameData);
        this.sente = gameData.sente;
        this.gote = gameData.gote;
        this.MsgToServer("new game created!");
    };

	p.StateChange = function(state){
		this.state = state;
    var room = this.GetSendableState();
		io.emit("roomstatechange",room);
	}

  p.GetSendableState = function(){
    var room = {};
		room.N = this.roomN;
		room.state = this.state;
		room.sente = this.sente.name;
		room.gote = this.gote.name;
		if(room.state == ROOMSTATE.WAITING){
			room.waitingname = this.clientList[0].name;
		}
    return room;
  }

    return Room;
})();

var Manager = (function () {
	var roomAllNum = 100;

    var Manager = function (num) {
        this.rooms = [];
        this.roomNum = num;
        for (var i = 1; i <= this.roomNum; i++) {
            this.rooms[i] = new Room(i);
        }
    };

    var p = Manager.prototype;

    //前から順に部屋を検索し、指定されたソケットがあれば部屋番号、無ければ0を返す関数
    p.WhereSocket = function (socket) {
        for (var i = 1; i <= this.roomNum; i++) {
            if (this.rooms[i].ContainSocket(socket)) {
                return i;
            }
        }
        return 0;
    };

    //指定されたソケットが存在すればその部屋からクライアントを削除する関数、戻り値に部屋番号、無ければ0を返す
    p.RemoveSocket = function(socket){
        var n = this.WhereSocket(socket);
        if(n==0){
            return 0;
        }else{
            this.rooms[n].RemoveClient(socket);
            return n;
        }
    };

    p.SendRoomState = function(socket){
      var rooms = [];
    	for(var i=1;i<=this.roomNum;i++){
        rooms[i] = this.rooms[i].GetSendableState();
    	}
      socket.emit("allroomstate",rooms);
    }
    return Manager;
})();



//全体を管理するオブジェクト
var mng = new Manager(100);

http.listen(app.get("port"), function () {
    console.log("port = %s", app.get("port"));
});
