var socket = io();

var ROOMSTATE = {
    EMPTY: 0,
    WAITING: 1,
    HAITIMODE: 2,
    BATTLE: 3,
    BATTLEFINISH: 4
}

var roomNum;

var rooms = [];
var roomElements = [];


onload = function(){
	roomNum = 100;
	var List = document.getElementById("roomList");
	
	for (var i = 1; i <= roomNum; i++) {
	    var room = document.createElement("li");
	    room.className = "list-group-item";
	    room.innerHTML = "<a href=\"game?r=" + i + "\">" + i + " : "+ "取得中" + "</a>";
	    roomElements[i] = room;
	    List.appendChild(room);
	}
	socket.emit("givemerooms",{});
};



socket.on("roomstatechange",function(room){
	var txt;
	switch(room.state){
		case ROOMSTATE.EMPTY:
			txt = "空室";
			break;
		case ROOMSTATE.WAITING:
			txt = "対戦待ちの人がいます";
			break;
		case ROOMSTATE.HAITIMODE:
		case ROOMSTATE.BATTLE:
		case ROOMSTATE.BATTLEFINISH:
			txt = room.sente + " vs " + room.gote;
			break;
	
	}
	var ihtml = "<a href=\"game?r=" + room.N + "\">" + room.N + " : "+ txt + "</a>";
	$(roomElements[room.N]).html(ihtml);
});