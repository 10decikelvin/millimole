let LOG_LEVEL = 0; //0=VERBOSE 1=WARN 2=ERROR

function levelStrToNumber(level){
    if((typeof level == "number") && (0 <= level) && (level <= 2)){
        return level;
    }
    switch (level){
        case "VERBOSE": return 0
        case "WARN": return 1
        case "ERROR": return 2
        default: throw new Error(`Invalid log level ${level}`)
    }
}
function levelToString(num){
    switch (num){
        case 0: return "VERBOSE"
        case 1: return "WARN"
        case 2: return "ERROR"
    }
}

export function setLogLevel(level){
    LOG_LEVEL = levelStrToNumber(level);
}
export function log(level, msg){
    let _l = levelStrToNumber(level);
    if( _l >= LOG_LEVEL){
        console.log(msg)
    }
}